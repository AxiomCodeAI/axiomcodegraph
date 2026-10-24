import * as fs from 'fs';
import * as path from 'path';

import * as ts from 'typescript';

import { DenoConfig, DenoContext, DenoImportMap, denoContextFor } from '@/parsers/typescript/deno/deno-config';
import {
  cachedNpmVersions, materialize, readLock, readRemote, RemoteModule,
} from '@/parsers/typescript/deno/deno-cache';
import { maxSatisfying } from '@/parsers/typescript/deno/deno-semver';

/**
 * Resolves a module specifier the way Deno does, for a file inside a Deno project.
 *
 * Order, as Deno applies it:
 *
 *   1. the import map: the member's `scopes` and `imports`, then the workspace
 *      root's (a key ending in `/` maps a prefix; a `jsr:` / `npm:` target also
 *      maps the key's subpaths, `"hono": "jsr:@hono/hono"` serving `hono/cors`);
 *   2. a workspace member by name (`@acme/shared`, `@acme/shared/ids`), through
 *      its `exports`;
 *   3. the target's scheme: `jsr:` to the version the lockfile pins (or the
 *      highest cached one in range) and the file its `exports` names; `npm:` to
 *      `node_modules` or Deno's npm cache; `https:` to the downloaded module,
 *      following redirects and an `x-typescript-types` header as Deno does.
 *
 * Relative specifiers and bare ones nothing above claims are NOT answered here:
 * `ts.resolveModuleName` already gets those right (`./a.ts` included) and a Deno
 * project with a `package.json` resolves its bare npm imports through
 * `node_modules` exactly as Node does.
 *
 * Every answer is a file that exists. A `jsr:` or URL module that was never
 * downloaded resolves to nothing, which is the honest answer for this machine.
 */
export type DenoResolutionKind =
  /** An import-map entry onto a project file. */
  | 'IMPORT_MAP'
  /** A workspace member imported by its name. */
  | 'WORKSPACE_MEMBER'
  | 'JSR'
  /** An npm package in Deno's own cache. */
  | 'NPM_CACHE'
  /** An npm package in the project's `node_modules`. */
  | 'NODE_MODULES'
  | 'REMOTE'
  | 'BUILTIN';

export interface DenoResolution {
  readonly resolvedFileName: string;
  /** The `ts.Extension` the file carries (`.ts`, `.d.ts`, …); `''` for a builtin. */
  readonly extension: string;
  readonly kind: DenoResolutionKind;
  /** `@std/path`, `zod`, `@acme/shared`; `''` for a project file or a URL. */
  readonly packageName: string;
}

const resolutions = new Map<string, DenoResolution | null>();

export function resolveDenoSpecifier(specifier: string, containingFile: string): DenoResolution | undefined {
  if (specifier === '' || isPathSpecifier(specifier)) {
    return undefined;
  }
  const context = denoContextFor(containingFile);
  if (context === undefined) {
    return undefined;
  }
  const key = `${path.dirname(path.resolve(containingFile))}\0${specifier}`;
  const cached = resolutions.get(key);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  let result: DenoResolution | undefined;
  try {
    result = resolveIn(specifier, path.resolve(containingFile), context);
  } catch {
    result = undefined;
  }
  // Scopes and member maps are keyed by directory, so the answer is too.
  resolutions.set(key, result ?? null);
  return result;
}

function resolveIn(specifier: string, containingFile: string, context: DenoContext): DenoResolution | undefined {
  const mapped = mapSpecifier(specifier, containingFile, context);
  if (mapped !== undefined && path.isAbsolute(mapped)) {
    const file = existingFile(mapped);
    return file === undefined ? undefined : { ...fileResolution(file), kind: 'IMPORT_MAP', packageName: '' };
  }
  const target = mapped ?? specifier;
  if (target.startsWith('node:')) {
    return { resolvedFileName: '', extension: '', kind: 'BUILTIN', packageName: '' };
  }
  if (target.startsWith('jsr:')) {
    return resolveJsr(target, context);
  }
  if (target.startsWith('npm:')) {
    return resolveNpm(target, containingFile, context);
  }
  if (target.startsWith('https:') || target.startsWith('http:')) {
    return resolveRemoteUrl(target, context.root);
  }
  return memberExport(target, context);
}

// ── 1. the import map ───────────────────────────────────────────────────────

function mapSpecifier(specifier: string, containingFile: string, context: DenoContext): string | undefined {
  const maps = context.member === context.root
    ? [context.member.importMap]
    : [context.member.importMap, context.root.importMap];
  for (const map of maps) {
    const hit = applyImportMap(specifier, containingFile, map);
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
}

export function applyImportMap(specifier: string, referrer: string, map: DenoImportMap): string | undefined {
  for (const scope of map.scopes) {
    if (referrer.startsWith(scope.prefix)) {
      const hit = matchImports(specifier, scope.imports);
      if (hit !== undefined) {
        return hit;
      }
    }
  }
  return matchImports(specifier, map.imports);
}

function matchImports(specifier: string, imports: ReadonlyMap<string, string>): string | undefined {
  const exact = imports.get(specifier);
  if (exact !== undefined) {
    return exact;
  }
  // The longest `prefix/` key, as the import-map spec chooses among several.
  let best: string | undefined;
  for (const key of imports.keys()) {
    if (key.endsWith('/') && specifier.startsWith(key) && (best === undefined || key.length > best.length)) {
      best = key;
    }
  }
  if (best !== undefined) {
    return joinTarget(imports.get(best)!, specifier.slice(best.length));
  }
  // Deno's own extension: a key that maps to a PACKAGE also serves its subpaths.
  let packageKey: string | undefined;
  for (const [key, target] of imports) {
    if (!key.endsWith('/') && specifier.startsWith(`${key}/`)
      && (target.startsWith('jsr:') || target.startsWith('npm:'))
      && (packageKey === undefined || key.length > packageKey.length)) {
      packageKey = key;
    }
  }
  return packageKey === undefined
    ? undefined
    : `${imports.get(packageKey)!}${specifier.slice(packageKey.length)}`;
}

function joinTarget(target: string, rest: string): string {
  if (path.isAbsolute(target)) {
    return path.join(target, ...rest.split('/'));
  }
  return target + rest;
}

// ── 2. workspace members ────────────────────────────────────────────────────

function memberExport(specifier: string, context: DenoContext): DenoResolution | undefined {
  for (const member of context.members) {
    if (member.name === '' || (specifier !== member.name && !specifier.startsWith(`${member.name}/`))) {
      continue;
    }
    const subpath = specifier === member.name ? '.' : `.${specifier.slice(member.name.length)}`;
    const target = member.exports.get(subpath);
    const file = target === undefined ? undefined : existingFile(target);
    if (file !== undefined) {
      return { ...fileResolution(file), kind: 'WORKSPACE_MEMBER', packageName: member.name };
    }
  }
  return undefined;
}

// ── 3a. jsr: ────────────────────────────────────────────────────────────────

const JSR = /^jsr:\/?(@[^/@]+\/[^/@]+)(?:@([^/]*))?(\/.*)?$/;

interface JsrMeta {
  readonly exports?: Record<string, string>;
}

function resolveJsr(target: string, context: DenoContext): DenoResolution | undefined {
  const m = JSR.exec(target);
  if (!m) {
    return undefined;
  }
  const name = m[1]!;
  const range = m[2] ?? '';
  const subpath = m[3] ?? '';
  // `jsr:@acme/shared` inside the workspace that defines it is the member, not a download.
  const member = memberExport(name + subpath, context);
  if (member !== undefined) {
    return member;
  }
  const root = context.root;
  const version = jsrVersion(name, range, root);
  if (version === undefined) {
    return undefined;
  }
  const meta = readJson<JsrMeta>(`https://jsr.io/${name}/${version}_meta.json`, root);
  const exported = meta?.exports?.[subpath === '' ? '.' : `.${subpath}`];
  if (exported === undefined) {
    return undefined;
  }
  const file = exported.replace(/^\.\//, '');
  const module = readRemote(`https://jsr.io/${name}/${version}/${file}`, root);
  const written = module === undefined ? undefined : materializeWithImports(module, root);
  return written === undefined
    ? undefined
    : { ...fileResolution(written), kind: 'JSR', packageName: name };
}

function jsrVersion(name: string, range: string, root: DenoConfig): string | undefined {
  const locked = readLock(root)?.jsr.get(name);
  if (locked !== undefined && locked.length > 0) {
    const pinned = maxSatisfying(locked, range);
    if (pinned !== undefined) {
      return pinned;
    }
  }
  // No lockfile, or it pins no version in range: the highest version the cache holds.
  const meta = readJson<{ versions?: Record<string, { yanked?: boolean }> }>(`https://jsr.io/${name}/meta.json`, root);
  const available = Object.entries(meta?.versions ?? {})
    .filter(([version, info]) => info?.yanked !== true
      && readRemote(`https://jsr.io/${name}/${version}_meta.json`, root) !== undefined)
    .map(([version]) => version);
  return maxSatisfying(available, range);
}

function readJson<T>(url: string, root: DenoConfig): T | undefined {
  const module = readRemote(url, root);
  if (module === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(module.text) as T;
  } catch {
    return undefined;
  }
}

// ── 3b. npm: ────────────────────────────────────────────────────────────────

const NPM = /^npm:\/?((?:@[^/@]+\/)?[^/@]+)(?:@([^/]*))?(\/.*)?$/;

/** What a Deno program resolves an npm package's entry with: ESM, `types` first. */
const NPM_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  customConditions: ['deno'],
  allowImportingTsExtensions: true,
  noEmit: true,
};

function resolveNpm(target: string, containingFile: string, context: DenoContext): DenoResolution | undefined {
  const m = NPM.exec(target);
  if (!m) {
    return undefined;
  }
  const name = m[1]!;
  const range = m[2] ?? '';
  const bare = name + (m[3] ?? '');
  // A project with node_modules (`nodeModulesDir`, or a package.json) installs there.
  const installed = ts.resolveModuleName(bare, containingFile, NPM_OPTIONS, ts.sys).resolvedModule;
  if (installed !== undefined && /[\\/]node_modules[\\/]/.test(installed.resolvedFileName)) {
    return {
      resolvedFileName: path.normalize(installed.resolvedFileName),
      extension: installed.extension,
      kind: 'NODE_MODULES',
      packageName: installed.packageId?.name ?? name,
    };
  }
  const cached = cachedNpmVersions(name);
  if (cached.size === 0) {
    return undefined;
  }
  const locked = readLock(context.root)?.npm.get(name)?.filter((v) => cached.has(v)) ?? [];
  const version = maxSatisfying(locked, range) ?? maxSatisfying(cached.keys(), range);
  const packageDir = version === undefined ? undefined : cached.get(version);
  if (packageDir === undefined) {
    return undefined;
  }
  const file = resolveInPackage(bare, name, packageDir);
  return file === undefined
    ? undefined
    : { resolvedFileName: file.resolvedFileName, extension: file.extension, kind: 'NPM_CACHE', packageName: name };
}

/**
 * `bare` resolved inside one unpacked package directory, honouring its
 * `exports` / `types` the way the compiler does for `node_modules`.
 *
 * Deno's cache is not a `node_modules` tree, so the compiler is shown one: a host
 * that answers for `<virtual>/node_modules/<name>/…` from `packageDir` and for
 * nothing else under the virtual root.
 */
function resolveInPackage(bare: string, name: string, packageDir: string):
  { resolvedFileName: string; extension: string } | undefined {
  const virtualRoot = path.join(path.parse(packageDir).root, '__axiomcode_deno_npm__');
  const virtualPackage = path.join(virtualRoot, 'node_modules', ...name.split('/'));
  const toReal = (p: string): string | undefined => {
    const normal = path.normalize(p);
    if (normal === virtualPackage || normal.startsWith(virtualPackage + path.sep)) {
      return packageDir + normal.slice(virtualPackage.length);
    }
    return undefined;
  };
  const host: ts.ModuleResolutionHost = {
    fileExists: (p) => {
      const real = toReal(p);
      return real !== undefined && fs.existsSync(real) && fs.statSync(real).isFile();
    },
    readFile: (p) => {
      const real = toReal(p);
      return real === undefined ? undefined : ts.sys.readFile(real);
    },
    directoryExists: (p) => {
      const normal = path.normalize(p);
      if (virtualPackage.startsWith(normal + path.sep) || normal === virtualPackage) {
        return true;
      }
      const real = toReal(p);
      return real !== undefined && fs.existsSync(real) && fs.statSync(real).isDirectory();
    },
    realpath: (p) => p,
    getCurrentDirectory: () => virtualRoot,
  };
  const resolved = ts.resolveModuleName(bare, path.join(virtualRoot, 'index.ts'), NPM_OPTIONS, host).resolvedModule;
  const real = resolved === undefined ? undefined : toReal(resolved.resolvedFileName);
  return real === undefined ? undefined : { resolvedFileName: real, extension: resolved!.extension };
}

// ── 3c. https: ──────────────────────────────────────────────────────────────

function resolveRemoteUrl(url: string, root: DenoConfig): DenoResolution | undefined {
  let module = followRedirects(url, root);
  if (module === undefined) {
    return undefined;
  }
  // A CDN that serves JavaScript points at its declarations, and Deno type-checks against those.
  const types = module.headers['x-typescript-types'];
  if (types !== undefined) {
    const declared = followRedirects(new URL(types, module.url).toString(), root);
    if (declared !== undefined) {
      module = declared;
    }
  }
  const written = materializeWithImports(module, root);
  return written === undefined ? undefined : { ...fileResolution(written), kind: 'REMOTE', packageName: '' };
}

/** URLs already copied to a mirror this process, so a cycle between modules ends. */
const materializedUrls = new Map<string, string | null>();

/**
 * Copies `module` to the mirror and, transitively, every module it imports that
 * Deno downloaded: a relative import by its URL, a `jsr:` / `npm:` / URL import
 * through this resolver from the mirrored file. A library parse of the mirror
 * then finds a package's whole reachable source, not only the entry the project
 * imported.
 */
function materializeWithImports(module: RemoteModule, root: DenoConfig): string | undefined {
  const known = materializedUrls.get(module.url);
  if (known !== undefined) {
    return known ?? undefined;
  }
  const relative = mirrorPathOf(module);
  const written = relative === undefined ? undefined : materialize(root, relative, module.text);
  materializedUrls.set(module.url, written ?? null);
  if (written === undefined) {
    return undefined;
  }
  for (const specifier of moduleSpecifiersOf(module.text, written)) {
    if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
      let target: string;
      try {
        target = new URL(specifier, module.url).toString();
      } catch {
        continue;
      }
      if (!materializedUrls.has(target)) {
        const imported = followRedirects(target, root);
        if (imported !== undefined) {
          materializeWithImports(imported, root);
        }
      }
    } else if (/^(jsr|npm|https?):/.test(specifier)) {
      resolveDenoSpecifier(specifier, written);
    }
  }
  return written;
}

function followRedirects(url: string, root: DenoConfig): RemoteModule | undefined {
  let current = url;
  for (let hop = 0; hop < 10; hop++) {
    const module = readRemote(current, root);
    if (module === undefined) {
      return undefined;
    }
    const location = module.headers.location;
    if (location === undefined) {
      return module;
    }
    current = new URL(location, current).toString();
  }
  return undefined;
}

const TS_LIKE = /\.(d\.ts|d\.mts|d\.cts|tsx?|mts|cts|jsx?|mjs|cjs)$/;

/** `deno.land/std@0.224.0/fmt/colors.ts`; an extensionless URL takes one from its content type. */
function mirrorPathOf(module: RemoteModule): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(module.url);
  } catch {
    return undefined;
  }
  const host = parsed.port === '' ? parsed.hostname : `${parsed.hostname}_PORT${parsed.port}`;
  const segments = parsed.pathname.split('/').filter((s) => s !== '').map((s) => decodeURIComponent(s));
  if (segments.length === 0) {
    segments.push('index');
  }
  let last = segments.pop()!;
  if (parsed.search !== '') {
    last += `_${Buffer.from(parsed.search).toString('base64url')}`;
  }
  if (!TS_LIKE.test(last) || parsed.search !== '') {
    const type = module.headers['content-type'] ?? '';
    last += /typescript|\/tsx?\b/.test(type) ? (/tsx/.test(type) ? '.tsx' : '.ts')
      : /javascript|ecmascript|\/jsx\b/.test(type) ? '.js'
        : TS_LIKE.exec(parsed.pathname)?.[0] ?? '.ts';
  }
  return path.join(host, ...segments, last);
}

/**
 * Every module specifier a file names, as the parser's extraction sees them:
 * imports and re-exports (`export * as ns from` included, which the compiler's
 * light pre-processor misses), `import x = require()`, `import()` / `require()`
 * with a literal, `import("x")` types, and triple-slash references. Missing one
 * here leaves a module out of the mirror until a later library parse copies it,
 * which changes the mirror and makes every rebuild recompile it.
 */
export function moduleSpecifiersOf(text: string, fileName: string): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false,
    /\.tsx$|\.jsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const literal = (node: ts.Node | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) {
      out.push(node.text);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      literal(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      literal(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      literal(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      literal(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  for (const reference of [...sf.referencedFiles, ...sf.typeReferenceDirectives]) {
    out.push(reference.fileName);
  }
  return out;
}

// ── files ───────────────────────────────────────────────────────────────────

function isPathSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..'
    || specifier.startsWith('/') || specifier.startsWith('file:') || /^[A-Za-z]:[\\/]/.test(specifier);
}

/** `target` itself, as Deno requires an explicit extension, else what the compiler's probing finds. */
function existingFile(target: string): string | undefined {
  try {
    if (fs.statSync(target).isFile()) {
      return path.normalize(target);
    }
  } catch {
    // not a file as written; probe below
  }
  const probed = ts.resolveModuleName(target, path.join(path.dirname(target), '__probe__.ts'),
    NPM_OPTIONS, ts.sys).resolvedModule;
  return probed === undefined ? undefined : path.normalize(probed.resolvedFileName);
}

const EXTENSIONS: readonly string[] = [
  ts.Extension.Dts, ts.Extension.Dmts, ts.Extension.Dcts,
  ts.Extension.Tsx, ts.Extension.Ts, ts.Extension.Mts, ts.Extension.Cts,
  ts.Extension.Jsx, ts.Extension.Js, ts.Extension.Mjs, ts.Extension.Cjs, ts.Extension.Json,
];

function fileResolution(file: string): { resolvedFileName: string; extension: string } {
  const extension = EXTENSIONS.find((e) => file.endsWith(e)) ?? '';
  return { resolvedFileName: path.normalize(file), extension };
}

/**
 * The package a specifier names in a Deno project, from the config and syntax
 * alone, for an import that did not resolve: `hono` mapped to `jsr:@hono/hono@^4`
 * names `@hono/hono`. `undefined` outside a Deno project or for a specifier the
 * import map and the schemes say nothing about; `''` for a URL or a project file.
 */
export function denoPackageNameOf(specifier: string, containingFile: string): string | undefined {
  if (isPathSpecifier(specifier)) {
    return undefined;
  }
  const context = denoContextFor(containingFile);
  if (context === undefined) {
    return undefined;
  }
  const target = mapSpecifier(specifier, path.resolve(containingFile), context) ?? specifier;
  if (path.isAbsolute(target) || /^https?:/.test(target) || target.startsWith('node:')) {
    return '';
  }
  const scheme = target.startsWith('jsr:') ? JSR.exec(target) : target.startsWith('npm:') ? NPM.exec(target) : null;
  return scheme ? scheme[1] : undefined;
}

/** Forgets memoised resolutions; for a test that rewrites a project in place. */
export function clearDenoResolutionCache(): void {
  resolutions.clear();
  materializedUrls.clear();
}
