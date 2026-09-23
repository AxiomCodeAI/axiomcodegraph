import * as fs from 'fs';
import * as path from 'path';
import * as sax from 'sax';

/**
 * What a `.csproj` says a file is compiled under: its target framework and its
 * preprocessor symbols.
 *
 * The symbols a project compiles under are written in its project files, never
 * in its sources, so without this every `#if FEATURE_X` and every
 * `#if NET8_0_OR_GREATER` takes the `#else`.
 *
 * ## What is evaluated, and what is not
 *
 * A SUBSET of MSBuild evaluation, in MSBuild's order: `Directory.Build.props`
 * (nearest ancestor), what the C# SDK props add (`TRACE`), the project body with
 * its local `<Import>`s and `<Choose>` blocks, the framework inference the SDK
 * does after the body (`TargetFrameworkIdentifier`, `TargetFrameworkVersion`,
 * `TargetPlatformIdentifier`), `Directory.Build.targets`, and the
 * configuration define (`DEBUG`). Properties, conditions, and the property
 * functions project files actually use for this. No SDK file is read and no
 * `dotnet` runs. A condition this cannot evaluate is FALSE and counted, never
 * guessed.
 *
 * ## One framework per project
 *
 * A multi-targeting project compiles once per framework. The analyzer can emit
 * one module per framework, but every row would multiply by the framework count.
 * So a project is read under ONE framework: the newest .NET (`net10.0` over
 * `net8.0`), then the newest `netstandard`, then the newest .NET Framework. That
 * is the build a developer runs by default and the one test runners pick first.
 *
 * ## Fixed host
 *
 * The host is Linux — `$(OS)` is `Unix`, `IsOSPlatform('linux')` is true — and
 * `$(Configuration)` is `Debug`, whatever machine this runs on, so two machines
 * extract the same bytes from the same tree. A project that chooses its
 * frameworks by host (a MAUI app drops `-ios` off macOS) is read as Linux reads it.
 */

export interface CsProjectConfig {
  /** Absolute path of the `.csproj`. */
  readonly projectFile: string;
  /**
   * Files named by an explicit `<Compile Include>` — the project's own or one
   * it imports (a shared project's `.projitems`) — resolved to absolute paths.
   * The default glob is not listed: it is the project's own directory.
   */
  readonly explicitCompile: readonly string[];
  readonly targetFramework: string;
  /** Everything the project lists, before the choice. */
  readonly targetFrameworks: readonly string[];
  /**
   * The written symbols: the project files' `DefineConstants` plus what the SDK
   * appends (`TRACE`, the configuration define). NOT the framework symbols —
   * the extractor adds those from `targetFramework` itself.
   */
  readonly defineConstants: readonly string[];
  /** False when the project sets `DisableImplicitFrameworkDefines` or is not SDK-style. */
  readonly implicitFrameworkDefines: boolean;
  readonly implicitUsings: boolean;
  /** `<Using Include>` items plus the SDK's implicit set when `ImplicitUsings` is on. */
  readonly usings: readonly string[];
  readonly langVersion: string;
  readonly nullable: string;
  readonly assemblyName: string;
  readonly sdk: string;
  /** Conditions that could not be evaluated and were taken as false. */
  readonly unevaluatedConditions: number;
  /** The first few of them, as written, so a wrong branch can be traced to its cause. */
  readonly unevaluatedExamples: readonly string[];
}

interface XNode {
  readonly name: string;
  readonly attrs: Record<string, string>;
  readonly children: XNode[];
  text: string;
}

// `Configuration` and `Platform` are NOT host properties: nothing sets them
// globally, the SDK defaults them only when empty (after Directory.Build.props),
// and a pre-SDK project writes its own `Condition="'$(Platform)' == ''"` default.
const HOST_PROPERTIES: Record<string, string> = {
  OS: 'Unix',
  Language: 'C#',
  MSBuildRuntimeType: 'Core',
};

/** The SDK's implicit global usings, per SDK (Microsoft.NET.Sdk.CSharp.props and the SDK-specific props). */
const IMPLICIT_USINGS: Record<string, readonly string[]> = {
  'Microsoft.NET.Sdk': [
    'System', 'System.Collections.Generic', 'System.IO', 'System.Linq', 'System.Net.Http',
    'System.Threading', 'System.Threading.Tasks',
  ],
  'Microsoft.NET.Sdk.Web': [
    'System.Net.Http.Json', 'Microsoft.AspNetCore.Builder', 'Microsoft.AspNetCore.Hosting',
    'Microsoft.AspNetCore.Http', 'Microsoft.AspNetCore.Routing', 'Microsoft.Extensions.Configuration',
    'Microsoft.Extensions.DependencyInjection', 'Microsoft.Extensions.Hosting', 'Microsoft.Extensions.Logging',
  ],
  'Microsoft.NET.Sdk.Worker': [
    'Microsoft.Extensions.Configuration', 'Microsoft.Extensions.DependencyInjection',
    'Microsoft.Extensions.Hosting', 'Microsoft.Extensions.Logging',
  ],
  'Microsoft.NET.Sdk.WindowsDesktop': [],
  'Microsoft.NET.Sdk.Razor': [],
  'Microsoft.NET.Sdk.BlazorWebAssembly': [
    'System.Net.Http.Json', 'Microsoft.AspNetCore.Components.WebAssembly.Hosting',
    'Microsoft.Extensions.Configuration', 'Microsoft.Extensions.DependencyInjection',
    'Microsoft.Extensions.Logging',
  ],
};

// ---------------------------------------------------------------------------
// XML

const xmlCache = new Map<string, XNode | null>();

function readXml(file: string): XNode | null {
  const cached = xmlCache.get(file);
  if (cached !== undefined) return cached;
  let root: XNode | null = null;
  try {
    const text = fs.readFileSync(file, 'utf-8');
    const parser = sax.parser(true, { trim: false });
    const stack: XNode[] = [];
    parser.onopentag = (tag) => {
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(tag.attributes)) attrs[k] = String(v);
      const node: XNode = { name: tag.name, attrs, children: [], text: '' };
      if (stack.length > 0) stack[stack.length - 1]!.children.push(node);
      else root = node;
      stack.push(node);
    };
    parser.ontext = (t) => { if (stack.length > 0) stack[stack.length - 1]!.text += t; };
    parser.oncdata = (t) => { if (stack.length > 0) stack[stack.length - 1]!.text += t; };
    parser.onclosetag = () => { stack.pop(); };
    parser.onerror = () => { throw new Error('xml'); };
    parser.write(text).close();
  } catch {
    root = null;
  }
  xmlCache.set(file, root);
  return root;
}

// ---------------------------------------------------------------------------
// Frameworks

interface Tfm {
  readonly identifier: string; // .NETCoreApp | .NETStandard | .NETFramework | ''
  readonly version: string;    // 8.0
  readonly platform: string;   // windows | android | ...
}

export function parseTfm(tf: string): Tfm {
  const [base = '', platform = ''] = tf.trim().toLowerCase().split('-', 2);
  let m = /^net(\d+)\.(\d+)$/.exec(base) ?? /^netcoreapp(\d+)\.(\d+)$/.exec(base);
  if (m) return { identifier: '.NETCoreApp', version: `${m[1]}.${m[2]}`, platform: platform.replace(/[\d.]+$/, '') };
  m = /^netstandard(\d+)\.(\d+)$/.exec(base);
  if (m) return { identifier: '.NETStandard', version: `${m[1]}.${m[2]}`, platform: '' };
  m = /^net(\d)(\d)(\d?)$/.exec(base);
  if (m) return { identifier: '.NETFramework', version: `${m[1]}.${m[2]}${m[3] ? '.' + m[3] : ''}`, platform: '' };
  return { identifier: '', version: '', platform: '' };
}

function tfRank(tf: string): number[] {
  const t = parseTfm(tf);
  const [a = 0, b = 0, c = 0] = t.version.split('.').map(Number);
  const family = t.identifier === '.NETCoreApp' ? 3 : t.identifier === '.NETStandard' ? 2 : t.identifier === '.NETFramework' ? 1 : 0;
  // A platform-neutral net10.0 over net10.0-windows: the neutral one is the build every OS runs.
  return [family, a, b, c, t.platform === '' ? 1 : 0];
}

/** The newest .NET, then netstandard, then .NET Framework. Ties keep the first written. */
export function pickTargetFramework(frameworks: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const tf of frameworks) {
    if (best === undefined) { best = tf; continue; }
    const a = tfRank(tf), b = tfRank(best);
    for (let i = 0; i < a.length; i++) {
      if (a[i]! !== b[i]!) { if (a[i]! > b[i]!) best = tf; break; }
    }
  }
  return best;
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** `[MSBuild]::IsTargetFrameworkCompatible(candidate, target)`: can `candidate` consume `target`? */
function tfCompatible(candidate: string, target: string): boolean {
  const c = parseTfm(candidate), t = parseTfm(target);
  if (c.identifier === '' || t.identifier === '') return false;
  if (t.platform !== '' && t.platform !== c.platform) return false;
  if (c.identifier === t.identifier) return compareVersions(c.version, t.version) >= 0;
  if (t.identifier === '.NETStandard') {
    if (c.identifier === '.NETCoreApp') return compareVersions(c.version, '2.0') >= 0 || compareVersions(t.version, '1.6') <= 0;
    if (c.identifier === '.NETFramework') return compareVersions(t.version, '2.0') <= 0 && compareVersions(c.version, '4.6.1') >= 0;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Evaluation

class Unevaluable extends Error {}

class Evaluator {
  readonly props = new Map<string, string>();
  readonly globals: ReadonlySet<string>;
  unevaluated = 0;
  readonly unevaluatedExamples: string[] = [];
  giveUp(text: string): void {
    this.unevaluated += 1;
    if (this.unevaluatedExamples.length < 5) this.unevaluatedExamples.push(text.trim().slice(0, 200));
  }
  readonly itemGroups: { node: XNode; dir: string; file: string }[] = [];

  constructor(globals: Record<string, string>) {
    for (const [k, v] of Object.entries(HOST_PROPERTIES)) this.props.set(k, v);
    for (const [k, v] of Object.entries(globals)) this.props.set(k, v);
    this.globals = new Set(Object.keys(globals));
  }

  get(name: string): string {
    // MSBuild property names are case-insensitive.
    const direct = this.props.get(name);
    if (direct !== undefined) return direct;
    const lower = name.toLowerCase();
    for (const [k, v] of this.props) if (k.toLowerCase() === lower) return v;
    return '';
  }

  set(name: string, value: string): void {
    for (const g of this.globals) if (g.toLowerCase() === name.toLowerCase()) return;
    for (const k of [...this.props.keys()]) if (k.toLowerCase() === name.toLowerCase() && k !== name) this.props.delete(k);
    this.props.set(name, value);
  }

  /** Expand `$(...)` (with property functions). `@(...)` and `%(...)` are left as written. */
  expand(text: string): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
      if (text[i] === '$' && text[i + 1] === '(') {
        const end = matchParen(text, i + 1);
        if (end < 0) throw new Unevaluable('unbalanced $(');
        out += this.property(text.slice(i + 2, end).trim());
        i = end + 1;
      } else {
        out += text[i];
        i += 1;
      }
    }
    return out;
  }

  private property(expr: string): string {
    // $([MSBuild]::Fn(args)) / $([System.String]::Fn(args))
    const staticCall = /^\[([\w.]+)\]::(\w+)\s*\(([\s\S]*)\)$/.exec(expr);
    if (staticCall) return this.staticFunction(staticCall[1]!, staticCall[2]!, this.args(staticCall[3]!));
    // A static PROPERTY: $([System.IO.Path]::DirectorySeparatorChar)
    const staticProperty = /^\[([\w.]+)\]::(\w+)$/.exec(expr);
    if (staticProperty) {
      const key = `${staticProperty[1]}::${staticProperty[2]}`;
      if (key === 'System.IO.Path::DirectorySeparatorChar' || key === 'System.IO.Path::AltDirectorySeparatorChar') return '/';
      if (key === 'System.IO.Path::PathSeparator') return ':';
      if (key === 'System.Environment::NewLine') return '\n';
      throw new Unevaluable(expr);
    }
    // $(Name) / $(Name.Method(args)) / $(Name.Method(args).Method(args))
    const m = /^([A-Za-z_][\w-]*)([\s\S]*)$/.exec(expr);
    if (!m) throw new Unevaluable(expr);
    let value = this.get(m[1]!);
    let rest = m[2]!.trim();
    while (rest.length > 0) {
      const call = /^\.(\w+)/.exec(rest);
      if (!call) throw new Unevaluable(expr);
      rest = rest.slice(call[0].length);
      let args: string[] = [];
      if (rest.startsWith('(')) {
        const end = matchParen(rest, 0);
        if (end < 0) throw new Unevaluable(expr);
        args = this.args(rest.slice(1, end));
        rest = rest.slice(end + 1).trim();
      }
      value = stringMethod(value, call[1]!, args);
    }
    return value;
  }

  private args(text: string): string[] {
    const out: string[] = [];
    let depth = 0, quote = '', cur = '';
    for (const ch of text) {
      if (quote) { if (ch === quote) quote = ''; cur += ch; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim() !== '' || out.length > 0) out.push(cur);
    return out.map((a) => {
      const t = a.trim();
      const unquoted = /^(['"`])([\s\S]*)\1$/.exec(t);
      return this.expand(unquoted ? unquoted[2]! : t);
    });
  }

  private staticFunction(type: string, fn: string, args: string[]): string {
    const a = (i: number): string => args[i] ?? '';
    if (type === 'MSBuild') {
      switch (fn) {
        case 'IsTargetFrameworkCompatible': return String(tfCompatible(a(0), a(1)));
        case 'GetTargetFrameworkIdentifier': return parseTfm(a(0)).identifier;
        case 'GetTargetFrameworkVersion': {
          const v = parseTfm(a(0)).version;
          const parts = Number(a(1) || '2');
          return v === '' ? '' : v.split('.').concat(['0', '0', '0']).slice(0, Math.max(parts, 2)).join('.');
        }
        case 'GetTargetPlatformIdentifier': {
          const p = parseTfm(a(0)).platform;
          return p === '' ? '' : p === 'ios' ? 'iOS' : p === 'maccatalyst' ? 'MacCatalyst' : p === 'macos' ? 'macOS' : p === 'tvos' ? 'tvOS' : p[0]!.toUpperCase() + p.slice(1);
        }
        case 'VersionGreaterThanOrEquals': return String(compareVersions(a(0), a(1)) >= 0);
        case 'VersionGreaterThan': return String(compareVersions(a(0), a(1)) > 0);
        case 'VersionLessThan': return String(compareVersions(a(0), a(1)) < 0);
        case 'VersionLessThanOrEquals': return String(compareVersions(a(0), a(1)) <= 0);
        case 'VersionEquals': return String(compareVersions(a(0), a(1)) === 0);
        // The fixed host is Linux (see "Fixed host" above).
        case 'IsOSPlatform': case 'IsOsPlatform': return String(a(0).toLowerCase() === 'linux');
        case 'IsOSUnixLike': return 'true';
        case 'EnsureTrailingSlash': return a(0) === '' || a(0).endsWith('/') ? a(0) : a(0) + '/';
        case 'NormalizeDirectory': return path.join(...args).replace(/\/?$/, '/');
        case 'NormalizePath': return path.join(...args);
        case 'GetDirectoryNameOfFileAbove': {
          let dir = path.resolve(a(0));
          for (;;) {
            if (fs.existsSync(path.join(dir, a(1)))) return dir;
            const up = path.dirname(dir);
            if (up === dir) return '';
            dir = up;
          }
        }
        case 'GetPathOfFileAbove': {
          const start = a(1) !== '' ? path.resolve(a(1)) : path.resolve(this.get('MSBuildThisFileDirectory'));
          let dir = path.dirname(start + '/x');
          dir = path.dirname(dir); // "above" starts at the parent
          for (;;) {
            const p = path.join(dir, a(0));
            if (fs.existsSync(p)) return p;
            const up = path.dirname(dir);
            if (up === dir) return '';
            dir = up;
          }
        }
        case 'ValueOrDefault': return a(0) !== '' ? a(0) : a(1);
        case 'Add': return String(Number(a(0)) + Number(a(1)));
        case 'Subtract': return String(Number(a(0)) - Number(a(1)));
        case 'Multiply': return String(Number(a(0)) * Number(a(1)));
        case 'Divide': return String(Number(a(0)) / Number(a(1)));
        case 'Modulo': return String(Number(a(0)) % Number(a(1)));
        default: throw new Unevaluable(`[MSBuild]::${fn}`);
      }
    }
    if (type === 'System.String' || type === 'string') {
      if (fn === 'Copy') return a(0);
      if (fn === 'IsNullOrEmpty') return String(a(0) === '');
      if (fn === 'IsNullOrWhiteSpace') return String(a(0).trim() === '');
      if (fn === 'Concat') return args.join('');
    }
    if (type === 'System.IO.Path' && fn === 'Combine') return path.join(...args);
    if (type === 'System.IO.Path' && fn === 'GetFileName') return path.basename(a(0));
    if (type === 'System.IO.Path' && fn === 'GetFileNameWithoutExtension') return path.basename(a(0), path.extname(a(0)));
    if (type === 'System.IO.Path' && fn === 'GetExtension') return path.extname(a(0));
    if (type === 'System.IO.Path' && fn === 'GetFullPath') return path.resolve(this.get('MSBuildProjectDirectory'), a(0));
    if (type === 'System.IO.Path' && fn === 'GetDirectoryName') return path.dirname(a(0));
    if (type === 'System.IO.File' && fn === 'Exists') return String(fs.existsSync(a(0)));
    if (type === 'System.IO.Directory' && fn === 'Exists') return String(fs.existsSync(a(0)));
    if (type === 'System.Environment' && fn === 'GetEnvironmentVariable') return '';
    if (type === 'System.Runtime.InteropServices.RuntimeInformation' && fn === 'IsOSPlatform') return String(/linux/i.test(a(0)));
    if (type === 'System.OperatingSystem') return fn === 'IsLinux' ? 'true' : 'false';
    throw new Unevaluable(`[${type}]::${fn}`);
  }

  /** MSBuild condition. Unevaluable → false, counted. */
  condition(text: string | undefined, dir: string): boolean {
    if (text === undefined || text.trim() === '') return true;
    try {
      const tokens = tokenizeCondition(text);
      const p = new ConditionParser(tokens, this, dir);
      const v = p.parseOr();
      if (p.pos !== tokens.length) throw new Unevaluable(text);
      return truthy(v);
    } catch (e) {
      if (!(e instanceof Unevaluable)) throw e;
      this.giveUp(text);
      return false;
    }
  }

  /**
   * The defaults an imported MSBuild SDK supplies (`$(NetCurrent)` and its
   * siblings), which a project can build every `TargetFramework` from. It lives in a NuGet
   * package, not the tree — but its values follow the SDK's own major version,
   * which the tree pins in `global.json` (`msbuild-sdks`). So they are seeded
   * from that, never read from a machine's package cache.
   */
  private seedArcade(dir: string): void {
    const globalJson = findAbove(dir, 'global.json');
    if (globalJson === undefined) return;
    let version = '';
    try {
      version = String(JSON.parse(fs.readFileSync(globalJson, 'utf-8'))?.['msbuild-sdks']?.['Microsoft.DotNet.Arcade.Sdk'] ?? '');
    } catch {
      return;
    }
    const major = Number(/^(\d+)\./.exec(version)?.[1] ?? NaN);
    if (!Number.isFinite(major)) return;
    const defaults: Record<string, string> = {
      NetCurrent: `net${major}.0`,
      NetMinimum: `net${major - 1}.0`,
      NetFrameworkCurrent: 'net481',
      NetFrameworkMinimum: 'net462',
      NetFrameworkToolCurrent: 'net472',
    };
    for (const [k, v] of Object.entries(defaults)) if (this.get(k) === '') this.set(k, v);
  }

  /** Walk one project file's top level, in order. */
  run(file: string, depth = 0): void {
    if (depth > 16) return;
    const root = readXml(file);
    if (root === null) return;
    const dir = path.dirname(file);
    const savedThis = [this.get('MSBuildThisFileDirectory'), this.get('MSBuildThisFile'), this.get('MSBuildThisFileFullPath')];
    this.props.set('MSBuildThisFileDirectory', dir + '/');
    this.props.set('MSBuildThisFile', path.basename(file));
    this.props.set('MSBuildThisFileFullPath', file);
    this.walk(root.children, dir, depth);
    this.props.set('MSBuildThisFileDirectory', savedThis[0]!);
    this.props.set('MSBuildThisFile', savedThis[1]!);
    this.props.set('MSBuildThisFileFullPath', savedThis[2]!);
  }

  private walk(nodes: readonly XNode[], dir: string, depth: number): void {
    for (const node of nodes) {
      switch (node.name) {
        case 'PropertyGroup':
          if (!this.condition(node.attrs.Condition, dir)) break;
          for (const p of node.children) {
            if (!this.condition(p.attrs.Condition, dir)) continue;
            try {
              this.set(p.name, this.expand(p.text.trim()));
            } catch (e) {
              if (!(e instanceof Unevaluable)) throw e;
              this.giveUp(`<${p.name}>${p.text.trim()}`);
            }
          }
          break;
        case 'Import': {
          if (!this.condition(node.attrs.Condition, dir) || node.attrs.Project === undefined) break;
          if (node.attrs.Sdk !== undefined) {
            if (node.attrs.Sdk.trim() === 'Microsoft.DotNet.Arcade.Sdk' && /Sdk\.props$/i.test(node.attrs.Project)) {
              this.seedArcade(dir);
            }
            break;
          }
          let target: string;
          try { target = this.expand(node.attrs.Project); } catch { this.giveUp(node.attrs.Project); break; }
          if (target === '' || /[*?]/.test(target)) break;
          const abs = path.isAbsolute(target) ? target : path.resolve(dir, target.replace(/\\/g, '/'));
          if (fs.existsSync(abs) && fs.statSync(abs).isFile()) this.run(abs, depth + 1);
          break;
        }
        case 'Choose': {
          for (const branch of node.children) {
            if (branch.name === 'When' && this.condition(branch.attrs.Condition, dir)) {
              this.walk(branch.children, dir, depth);
              break;
            }
            if (branch.name === 'Otherwise') {
              this.walk(branch.children, dir, depth);
              break;
            }
          }
          break;
        }
        case 'ItemGroup':
          this.itemGroups.push({ node, dir, file: this.get('MSBuildThisFileFullPath') });
          break;
        default:
          break;
      }
    }
  }
}

function truthy(v: string | boolean): boolean {
  return typeof v === 'boolean' ? v : v.toLowerCase() === 'true';
}

function matchParen(text: string, open: number): number {
  let depth = 0, quote = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function stringMethod(value: string, method: string, args: string[]): string {
  const a = (i: number): string => args[i] ?? '';
  switch (method) {
    case 'StartsWith': return String(value.startsWith(a(0)));
    case 'EndsWith': return String(value.endsWith(a(0)));
    case 'Contains': return String(value.includes(a(0)));
    case 'ToUpperInvariant': case 'ToUpper': return value.toUpperCase();
    case 'ToLowerInvariant': case 'ToLower': return value.toLowerCase();
    case 'Trim': return a(0) === '' ? value.trim() : value.split('').filter((c) => !a(0).includes(c)).join('');
    case 'TrimEnd': return a(0) === '' ? value.trimEnd() : value.replace(new RegExp(`[${escapeRe(a(0))}]+$`), '');
    case 'TrimStart': return a(0) === '' ? value.trimStart() : value.replace(new RegExp(`^[${escapeRe(a(0))}]+`), '');
    case 'Replace': return value.split(a(0)).join(a(1));
    case 'Substring': return args.length > 1 ? value.substr(Number(a(0)), Number(a(1))) : value.substring(Number(a(0)));
    case 'IndexOf': return String(value.indexOf(a(0)));
    case 'Length': return String(value.length);
    case 'Split': return value;
    case 'Equals': return String(value === a(0));
    default: throw new Unevaluable(`.${method}`);
  }
}

function escapeRe(s: string): string {
  return s.replace(/[\\\]^-]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Conditions: 'a' == 'b', !=, <, >, <=, >=, and, or, !, (), Exists(), HasTrailingSlash(), bare $(x) / true / false

type Tok = { t: 'str' | 'op' | 'word' | '(' | ')' | ','; v: string };

function tokenizeCondition(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "'" || ch === '"') {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) throw new Unevaluable(text);
      out.push({ t: 'str', v: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (ch === '$' && text[i + 1] === '(') {
      const end = matchParen(text, i + 1);
      if (end < 0) throw new Unevaluable(text);
      out.push({ t: 'str', v: text.slice(i, end + 1) });
      i = end + 1;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (['==', '!=', '<=', '>='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if (ch === '<' || ch === '>' || ch === '!') { out.push({ t: 'op', v: ch }); i++; continue; }
    if (ch === '(' || ch === ')' || ch === ',') { out.push({ t: ch, v: ch }); i++; continue; }
    const w = /^[A-Za-z_][\w.]*/.exec(text.slice(i));
    if (w) { out.push({ t: 'word', v: w[0] }); i += w[0].length; continue; }
    const num = /^[\d.]+/.exec(text.slice(i));
    if (num) { out.push({ t: 'str', v: num[0] }); i += num[0].length; continue; }
    throw new Unevaluable(text);
  }
  return out;
}

class ConditionParser {
  pos = 0;
  constructor(private readonly toks: Tok[], private readonly ev: Evaluator, private readonly dir: string) {}

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private isWord(w: string): boolean { const t = this.peek(); return t?.t === 'word' && t.v.toLowerCase() === w; }

  parseOr(): string | boolean {
    let left = this.parseAnd();
    while (this.isWord('or')) { this.pos++; const right = this.parseAnd(); left = truthy(left) || truthy(right); }
    return left;
  }

  private parseAnd(): string | boolean {
    let left = this.parseNot();
    while (this.isWord('and')) { this.pos++; const right = this.parseNot(); left = truthy(left) && truthy(right); }
    return left;
  }

  private parseNot(): string | boolean {
    const t = this.peek();
    if (t?.t === 'op' && t.v === '!') { this.pos++; return !truthy(this.parseNot()); }
    return this.parseCompare();
  }

  private parseCompare(): string | boolean {
    const left = this.parseAtom();
    const t = this.peek();
    if (t?.t !== 'op' || t.v === '!') return left;
    this.pos++;
    const right = this.parseAtom();
    const l = String(left), r = String(right);
    switch (t.v) {
      case '==': return l.toLowerCase() === r.toLowerCase();
      case '!=': return l.toLowerCase() !== r.toLowerCase();
      default: {
        const ln = Number(l), rn = Number(r);
        const c = !Number.isNaN(ln) && !Number.isNaN(rn) ? ln - rn : compareVersions(l, r);
        return t.v === '<' ? c < 0 : t.v === '>' ? c > 0 : t.v === '<=' ? c <= 0 : c >= 0;
      }
    }
  }

  private parseAtom(): string | boolean {
    const t = this.toks[this.pos++];
    if (t === undefined) throw new Unevaluable('eof');
    if (t.t === 'str') return this.ev.expand(t.v);
    if (t.t === '(') {
      const v = this.parseOr();
      if (this.toks[this.pos++]?.t !== ')') throw new Unevaluable(')');
      return v;
    }
    if (t.t === 'word') {
      const w = t.v.toLowerCase();
      if (w === 'true' || w === 'false') return w;
      if (this.peek()?.t === '(') {
        this.pos++;
        const args: string[] = [];
        while (this.peek() !== undefined && this.peek()!.t !== ')') {
          const a = this.parseAtom();
          args.push(String(a));
          if (this.peek()?.t === ',') this.pos++;
        }
        this.pos++;
        if (w === 'exists') {
          const p = (args[0] ?? '').replace(/\\/g, '/').trim();
          return p !== '' && fs.existsSync(path.isAbsolute(p) ? p : path.resolve(this.dir, p));
        }
        if (w === 'hastrailingslash') return /[\\/]$/.test(args[0] ?? '');
      }
    }
    throw new Unevaluable(t.v);
  }
}

// ---------------------------------------------------------------------------

function findAbove(startDir: string, name: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
    const up = path.dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

function sdkOf(root: XNode): string {
  const attr = root.attrs.Sdk;
  if (attr) return attr.split(';')[0]!.split('/')[0]!.trim();
  for (const c of root.children) {
    if ((c.name === 'Sdk' || c.name === 'Import') && c.attrs.Sdk) return c.attrs.Sdk.split('/')[0]!.trim();
    if (c.name === 'Sdk' && c.attrs.Name) return c.attrs.Name.trim();
  }
  return '';
}

function splitList(v: string): string[] {
  return v.split(';').map((s) => s.trim()).filter((s) => s !== '');
}

/** Evaluate once with the given globals. */
function evaluateProject(projectFile: string, globals: Record<string, string>): Evaluator {
  const dir = path.dirname(projectFile);
  const root = readXml(projectFile);
  const ev = new Evaluator(globals);
  const name = path.basename(projectFile, path.extname(projectFile));
  for (const [k, v] of Object.entries({
    MSBuildProjectDirectory: dir,
    MSBuildProjectFile: path.basename(projectFile),
    MSBuildProjectFullPath: projectFile,
    MSBuildProjectName: name,
    MSBuildProjectExtension: path.extname(projectFile),
    MSBuildStartupDirectory: dir,
  })) ev.props.set(k, v);
  const sdk = root ? sdkOf(root) : '';
  if (sdk !== '') {
    // Microsoft.Common.props imports the nearest Directory.Build.props first.
    const dbp = findAbove(dir, 'Directory.Build.props');
    if (dbp) ev.run(dbp);
    // Microsoft.Common.props: the defaults, only where nothing set them.
    if (ev.get('Configuration') === '') ev.set('Configuration', 'Debug');
    if (ev.get('Platform') === '') ev.set('Platform', 'AnyCPU');
    // Microsoft.NET.Sdk.CSharp.props
    const dc = ev.get('DefineConstants');
    ev.set('DefineConstants', (dc !== '' ? dc + ';' : '') + 'TRACE');
  }
  ev.run(projectFile);
  if (sdk !== '') {
    // Microsoft.NET.TargetFrameworkInference.targets, after the body.
    const tf = ev.get('TargetFramework');
    if (tf !== '') {
      const t = parseTfm(tf);
      if (ev.get('TargetFrameworkIdentifier') === '') ev.set('TargetFrameworkIdentifier', t.identifier);
      if (ev.get('TargetFrameworkVersion') === '' && t.version !== '') ev.set('TargetFrameworkVersion', 'v' + t.version);
      if (ev.get('TargetPlatformIdentifier') === '' && t.platform !== '') {
        ev.set('TargetPlatformIdentifier', ev.expand(`$([MSBuild]::GetTargetPlatformIdentifier('${tf}'))`));
      }
    }
    // Microsoft.Common.targets imports the nearest Directory.Build.targets.
    const dbt = findAbove(dir, 'Directory.Build.targets');
    if (dbt) ev.run(dbt);
    // Microsoft.NET.Sdk.CSharp.targets: the configuration define.
    if (ev.get('DisableImplicitConfigurationDefines').toLowerCase() !== 'true') {
      const cfg = ev.get('Configuration').toUpperCase().replace(/[-. ]/g, '_');
      if (cfg !== '') ev.set('DefineConstants', `${ev.get('DefineConstants')};${cfg}`);
    }
  }
  return ev;
}

const configCache = new Map<string, CsProjectConfig | null>();

export function readProjectConfig(projectFile: string): CsProjectConfig | null {
  const abs = path.resolve(projectFile);
  const cached = configCache.get(abs);
  if (cached !== undefined) return cached;
  let result: CsProjectConfig | null = null;
  const root = readXml(abs);
  if (root !== null) {
    const outer = evaluateProject(abs, {});
    const listed = splitList(outer.get('TargetFrameworks'));
    const single = outer.get('TargetFramework').trim();
    let frameworks = listed.length > 0 ? listed : single !== '' ? [single] : [];
    const sdk = sdkOf(root);
    if (frameworks.length === 0 && sdk === '') {
      // A pre-SDK project names its framework by version: v4.7.2 → net472.
      // Microsoft.Common.CurrentVersion.targets defaults an unset version to v4.0.
      const v = (outer.get('TargetFrameworkVersion') || 'v4.0').replace(/^v/i, '');
      if (/^\d+(\.\d+)*$/.test(v)) frameworks = [`net${v.split('.').join('')}`];
    }
    const tf = pickTargetFramework(frameworks) ?? '';
    const ev = listed.length > 0 && tf !== '' ? evaluateProject(abs, { TargetFramework: tf }) : outer;
    const implicitUsings = ['enable', 'true'].includes(ev.get('ImplicitUsings').trim().toLowerCase());
    const usings = new Set<string>();
    if (implicitUsings) {
      for (const u of IMPLICIT_USINGS['Microsoft.NET.Sdk']!) usings.add(u);
      for (const u of IMPLICIT_USINGS[sdk] ?? []) usings.add(u);
    }
    const explicitCompile = new Set<string>();
    for (const { node, dir, file } of ev.itemGroups) {
      // An item is expanded in the file that wrote it: `$(MSBuildThisFileDirectory)`
      // in a `.projitems` is the shared project's directory, not the consumer's.
      ev.props.set('MSBuildThisFileDirectory', dir + '/');
      ev.props.set('MSBuildThisFileFullPath', file);
      if (!ev.condition(node.attrs.Condition, dir)) continue;
      for (const item of node.children) {
        if (item.name === 'Compile' && item.attrs.Include !== undefined && ev.condition(item.attrs.Condition, dir)) {
          try {
            for (const pattern of splitList(ev.expand(item.attrs.Include))) {
              for (const f of expandGlob(pattern.replace(/\\/g, '/'), dir)) explicitCompile.add(f);
            }
          } catch (e) {
            if (!(e instanceof Unevaluable)) throw e;
            ev.giveUp(item.attrs.Include);
          }
          continue;
        }
        if (item.name !== 'Using' || !ev.condition(item.attrs.Condition, dir)) continue;
        if (item.attrs.Alias !== undefined || (item.attrs.Static ?? '').toLowerCase() === 'true') continue;
        try {
          if (item.attrs.Include !== undefined) for (const u of splitList(ev.expand(item.attrs.Include))) usings.add(u);
          if (item.attrs.Remove !== undefined) for (const u of splitList(ev.expand(item.attrs.Remove))) usings.delete(u);
        } catch (e) {
          if (!(e instanceof Unevaluable)) throw e;
          ev.giveUp(item.attrs.Include ?? item.attrs.Remove ?? '');
        }
      }
    }
    result = {
      projectFile: abs,
      explicitCompile: [...explicitCompile].sort(),
      targetFramework: tf,
      targetFrameworks: frameworks,
      defineConstants: [...new Set(splitList(ev.get('DefineConstants')))],
      implicitFrameworkDefines: sdk !== '' && ev.get('DisableImplicitFrameworkDefines').toLowerCase() !== 'true',
      implicitUsings,
      usings: [...usings].sort(),
      langVersion: ev.get('LangVersion'),
      nullable: ev.get('Nullable'),
      assemblyName: ev.get('AssemblyName') || path.basename(abs, path.extname(abs)),
      sdk,
      unevaluatedConditions: ev.unevaluated,
      unevaluatedExamples: ev.unevaluatedExamples,
    };
  }
  configCache.set(abs, result);
  return result;
}

/** `a/b/*.cs`, `a/**\/*.cs`, or a plain path, relative to `dir`. Only `.cs` files. */
function expandGlob(pattern: string, dir: string): string[] {
  const abs = path.isAbsolute(pattern) ? pattern : path.resolve(dir, pattern);
  if (!/[*?]/.test(abs)) return abs.endsWith('.cs') && fs.existsSync(abs) ? [path.resolve(abs)] : [];
  const parts = abs.split('/');
  const firstWild = parts.findIndex((p) => /[*?]/.test(p));
  const base = parts.slice(0, firstWild).join('/') || '/';
  const rest = parts.slice(firstWild);
  const toRe = (seg: string): RegExp =>
    new RegExp('^' + seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  const out: string[] = [];
  const walk = (d: string, i: number): void => {
    if (i === rest.length) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    const seg = rest[i]!;
    if (seg === '**') {
      walk(d, i + 1);
      for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(path.join(d, e.name), i);
      return;
    }
    const re = toRe(seg);
    for (const e of entries) {
      if (!re.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (i === rest.length - 1) { if (e.isFile() && e.name.endsWith('.cs')) out.push(p); }
      else if (e.isDirectory()) walk(p, i + 1);
    }
  };
  walk(base, 0);
  return out;
}

const SKIP_DIRS = new Set(['bin', 'obj', '.git', 'node_modules', 'packages', '.vs']);

const claimsCache = new Map<string, Map<string, string[]>>();

/**
 * Every file some project under `root` names by an explicit `<Compile Include>`,
 * with the projects that name it. This is how a file that lives in a SHARED
 * project (`.shproj` + `.projitems`, no `.csproj` of its own) or a linked file
 * (`<Compile Include="..\Shared\X.cs" Link=… />`) finds the project that
 * compiles it.
 */
function compileClaims(root: string): Map<string, string[]> {
  const cached = claimsCache.get(root);
  if (cached !== undefined) return cached;
  const claims = new Map<string, string[]>();
  const stack = [root];
  const projects: string[] = [];
  while (stack.length > 0) {
    const d = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) stack.push(path.join(d, e.name));
      else if (e.isFile() && e.name.endsWith('.csproj')) projects.push(path.join(d, e.name));
    }
  }
  for (const project of projects.sort()) {
    const config = readProjectConfig(project);
    for (const f of config?.explicitCompile ?? []) {
      const list = claims.get(f) ?? [];
      list.push(project);
      claims.set(f, list);
    }
  }
  claimsCache.set(root, claims);
  return claims;
}

/** Among several projects that compile one file, the one read under the newest framework; then the first by path. */
function bestClaimant(projects: readonly string[]): string {
  const byTf = new Map<string, string>();
  for (const p of projects) {
    const tf = readProjectConfig(p)?.targetFramework ?? '';
    if (!byTf.has(tf)) byTf.set(tf, p);
  }
  const tf = pickTargetFramework([...byTf.keys()]) ?? '';
  return byTf.get(tf) ?? projects[0]!;
}

const governingCache = new Map<string, string | null>();

/**
 * The project that compiles a file: the nearest `.csproj` in its directory or
 * above, stopping at `stopDir`. Two in one directory: the first by name.
 */
export function governingProject(absoluteFile: string, stopDir: string): string | undefined {
  let dir = path.dirname(absoluteFile);
  const stop = path.resolve(stopDir);
  const visited: string[] = [];
  let found: string | null = null;
  for (;;) {
    const cached = governingCache.get(dir);
    if (cached !== undefined) { found = cached; break; }
    visited.push(dir);
    let entries: string[] = [];
    try { entries = fs.readdirSync(dir); } catch { /* unreadable */ }
    const projects = entries.filter((e) => e.endsWith('.csproj')).sort();
    if (projects.length > 0) { found = path.join(dir, projects[0]!); break; }
    const up = path.dirname(dir);
    if (dir === stop || up === dir || !dir.startsWith(stop)) { found = null; break; }
    dir = up;
  }
  for (const v of visited) governingCache.set(v, found);
  if (found !== null) return found;
  // No project above it: a shared or linked file. The projects that name it decide.
  const claimants = compileClaims(stop).get(path.resolve(absoluteFile));
  return claimants !== undefined && claimants.length > 0 ? bestClaimant(claimants) : undefined;
}
