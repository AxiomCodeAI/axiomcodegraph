import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DenoConfig, readJsonc } from '@/parsers/typescript/deno/deno-config';

/**
 * Where Deno keeps what a project downloaded, read without running Deno.
 *
 * ## The two stores
 *
 * - **Remote modules** (`jsr:` packages and `https:` imports) live in
 *   `$DENO_DIR/remote/<scheme>/<host>/<sha256(path+query)>`: a file with no
 *   extension whose body is the module and whose LAST line is a
 *   `// denoCacheMetadata={…}` comment carrying the response headers. With
 *   `"vendor": true` the same modules sit under `<project>/vendor/<host>/<path>`.
 * - **npm packages** live unpacked in `$DENO_DIR/npm/<registry>/<name>/<version>/`
 *   (or in `node_modules` when the project has one).
 *
 * ## The mirror
 *
 * A hashed, extensionless cache file is not something a parser walk can stage as
 * a library, and its path names no package. So a remote module a project imports
 * is copied to a MIRROR laid out exactly as `vendor/` is (`jsr.io/@std/path/1.1.6/
 * mod.ts`), one mirror per Deno project. An import then resolves to a real `.ts`
 * file, and the mirror is one library root whose module paths carry the package
 * and version, which is what keeps `@std/path`'s `mod.ts` apart from `@std/fs`'s
 * when the engine matches a resolved path against library modules.
 */

/** `$DENO_DIR`, or the platform default Deno itself uses. */
export function denoDir(): string {
  if (process.env.DENO_DIR) {
    return path.resolve(process.env.DENO_DIR);
  }
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Caches', 'deno');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'deno');
  }
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(home, '.cache'), 'deno');
}

export interface RemoteModule {
  readonly url: string;
  readonly text: string;
  /** Response headers, lower-cased. Empty for a vendored file. */
  readonly headers: Readonly<Record<string, string>>;
}

const METADATA_MARKER = '\n// denoCacheMetadata=';

/**
 * A remote module as the project's Deno would load it: from `vendor/` when the
 * project vendors, else from `$DENO_DIR`. `undefined` when it was never downloaded.
 */
export function readRemote(url: string, root: DenoConfig): RemoteModule | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (root.vendor) {
    const vendored = path.join(root.dir, 'vendor', hostDir(parsed), ...decodedSegments(parsed));
    const text = readText(vendored);
    if (text !== undefined) {
      return { url, text, headers: {} };
    }
  }
  const hostCache = path.join(denoDir(), 'remote', parsed.protocol.replace(/:$/, ''), hostDir(parsed));
  let cached = '';
  let raw: string | undefined;
  for (const key of cacheKeysOf(parsed)) {
    cached = path.join(hostCache, crypto.createHash('sha256').update(key).digest('hex'));
    raw = readText(cached);
    if (raw !== undefined) {
      break;
    }
  }
  if (raw === undefined) {
    return undefined;
  }
  const at = raw.lastIndexOf(METADATA_MARKER);
  if (at >= 0) {
    return { url, text: raw.slice(0, at), headers: headersOf(raw.slice(at + METADATA_MARKER.length)) };
  }
  // Deno before the inline trailer kept the headers in a sidecar file.
  const sidecar = readText(`${cached}.metadata.json`);
  return { url, text: raw, headers: sidecar === undefined ? {} : headersOf(sidecar) };
}

/**
 * The path and query Deno hashed for `url`. Deno's URL parser leaves a `^` in a
 * path as written (`esm.sh/type-fest@^4.11.1`), where this one escapes it to
 * `%5E`, so the unescaped spelling is tried as well.
 */
function cacheKeysOf(url: URL): string[] {
  const key = url.pathname + url.search;
  const unescaped = url.pathname.replace(/%5E/gi, '^') + url.search;
  return unescaped === key ? [key] : [key, unescaped];
}

function headersOf(json: string): Record<string, string> {
  try {
    const meta = JSON.parse(json.trim()) as { headers?: Record<string, unknown> };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(meta.headers ?? {})) {
      if (typeof v === 'string') {
        out[k.toLowerCase()] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** `deno.land`, or `localhost_PORT8000` as Deno spells a host with a port. */
function hostDir(url: URL): string {
  return url.port === '' ? url.hostname : `${url.hostname}_PORT${url.port}`;
}

function decodedSegments(url: URL): string[] {
  return url.pathname.split('/').filter((s) => s !== '').map((s) => decodeURIComponent(s));
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
}

/** The versions a lockfile pins, per package name, for each registry. */
export interface DenoLock {
  readonly jsr: ReadonlyMap<string, readonly string[]>;
  readonly npm: ReadonlyMap<string, readonly string[]>;
  /** Remote URL to the URL it redirected to (`esm.sh/ky@1.7` to `esm.sh/ky@1.7.5`). */
  readonly redirects: ReadonlyMap<string, string>;
  readonly text: string;
}

const locks = new Map<string, DenoLock | null>();

/** The lockfile beside `root`, in any of the v3 to v5 layouts, or `undefined`. */
export function readLock(root: DenoConfig): DenoLock | undefined {
  if (root.lockPath === false) {
    return undefined;
  }
  const cached = locks.get(root.lockPath);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  const text = readText(root.lockPath);
  let result: DenoLock | undefined;
  if (text !== undefined) {
    const json = readJsonc(root.lockPath) as Record<string, unknown> | undefined;
    if (json !== undefined && json !== null && typeof json === 'object') {
      // v4 and v5 keep `jsr` and `npm` at the top; v3 nests them under `packages`.
      const packages = (json.packages ?? {}) as Record<string, unknown>;
      result = {
        jsr: versionsByName(json.jsr ?? packages.jsr),
        npm: versionsByName(json.npm ?? packages.npm),
        redirects: redirectsOf(json.redirects),
        text,
      };
    }
  }
  locks.set(root.lockPath, result ?? null);
  return result;
}

function redirectsOf(section: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (section !== null && typeof section === 'object') {
    for (const [from, to] of Object.entries(section as Record<string, unknown>)) {
      if (typeof to === 'string') {
        out.set(from, to);
      }
    }
  }
  return out;
}

/** `{"@std/path@1.1.6": …, "zod@3.25.76_peer@1.0.0": …}` to name → versions. */
function versionsByName(section: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (section === null || typeof section !== 'object') {
    return out;
  }
  for (const key of Object.keys(section as Record<string, unknown>)) {
    const at = key.indexOf('@', 1);
    if (at < 0) {
      continue;
    }
    const name = key.slice(0, at);
    // An npm key carries its peer resolution after `_`; the version is before it.
    const version = key.slice(at + 1).split('_')[0]!;
    out.set(name, [...(out.get(name) ?? []), version]);
  }
  return out;
}

/** Every version of an npm package unpacked in `$DENO_DIR/npm`, with its directory. */
export function cachedNpmVersions(name: string): Map<string, string> {
  const out = new Map<string, string>();
  const npmRoot = path.join(denoDir(), 'npm');
  let registries: string[] = [];
  try {
    registries = fs.readdirSync(npmRoot);
  } catch {
    return out;
  }
  // The public registry first, so a mirror registry holding the same version does not win.
  registries.sort((a, b) => (b === 'registry.npmjs.org' ? 1 : 0) - (a === 'registry.npmjs.org' ? 1 : 0));
  for (const registry of registries) {
    const dir = path.join(npmRoot, registry, ...name.split('/'));
    let versions: string[] = [];
    try {
      versions = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const version of versions) {
      const pkgDir = path.join(dir, version);
      if (!out.has(version) && fs.existsSync(path.join(pkgDir, 'package.json'))) {
        out.set(version, pkgDir);
      }
    }
  }
  return out;
}

/**
 * The mirror directory for a Deno project: `$AXIOMCODE_DENO_MIRROR` when set,
 * else one directory per project under the axiomcode cache.
 */
export function mirrorRoot(root: DenoConfig): string {
  // A library parse OF a mirror resolves inside it rather than minting a mirror of the mirror.
  if (fs.existsSync(path.join(root.dir, MIRROR_MARKER))) {
    return root.dir;
  }
  if (process.env.AXIOMCODE_DENO_MIRROR) {
    return path.resolve(process.env.AXIOMCODE_DENO_MIRROR);
  }
  const base = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
  let real = root.dir;
  try {
    real = fs.realpathSync(root.dir);
  } catch {
    // an unreadable root keeps its written path
  }
  const key = crypto.createHash('sha1').update(real).digest('hex').slice(0, 12);
  return path.join(base, 'axiomcode', 'deno', `${path.basename(real) || 'root'}-${key}`);
}

/** The file that marks a directory as a mirror this module wrote. */
export const MIRROR_MARKER = '.axiomcode-deno-mirror';

const preparedMirrors = new Set<string>();

/**
 * Writes `text` to `<mirror>/<relative>` unless it is already there, and returns
 * the absolute path. The write is a rename, so two parse workers writing the same
 * module never leave a torn file.
 *
 * The first write to a mirror also gives it a `deno.json` and the project's
 * lockfile: a library parse of the mirror then resolves the `jsr:` imports INSIDE
 * the mirrored packages to the same pinned versions the project uses.
 */
export function materialize(root: DenoConfig, relative: string, text: string): string | undefined {
  const mirror = mirrorRoot(root);
  const target = path.join(mirror, relative);
  try {
    if (!preparedMirrors.has(mirror)) {
      fs.mkdirSync(mirror, { recursive: true });
      writeIfChanged(path.join(mirror, MIRROR_MARKER), '');
      writeIfChanged(path.join(mirror, 'deno.json'), '{}\n');
      const lock = readLock(root);
      if (lock !== undefined) {
        writeIfChanged(path.join(mirror, 'deno.lock'), lock.text);
      }
      preparedMirrors.add(mirror);
    }
    writeIfChanged(target, text);
    return target;
  } catch {
    return undefined;
  }
}

function writeIfChanged(file: string, text: string): void {
  if (readText(file) === text) {
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}

/** Forgets cached lockfiles and prepared mirrors; for a test that rewrites them. */
export function clearDenoCacheState(): void {
  locks.clear();
  preparedMirrors.clear();
}
