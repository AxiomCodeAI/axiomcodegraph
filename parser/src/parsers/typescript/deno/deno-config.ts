import * as fs from 'fs';
import * as path from 'path';

import * as ts from 'typescript';

/**
 * Which `deno.json` governs a file, and what it says.
 *
 * ## Why Deno needs its own reading
 *
 * A Deno program has no `tsconfig.json` and no `node_modules` to speak of. Its
 * module graph is written in `deno.json`: an import map (`imports`, `scopes`, or
 * an `importMap` file) turns a bare specifier into a file, a `jsr:` / `npm:`
 * package or a URL, and a `workspace` lists the member packages that import one
 * another by NAME. `ts.resolveModuleName` knows none of it, so before this file
 * every `import { Hono } from "hono"` in a Deno service resolved to nothing and
 * every call across a workspace member was matched by name only.
 *
 * ## Member and root
 *
 * The NEAREST config is the member that owns the file. A workspace root lists its
 * members; its import map applies to every member, and the member's own entries
 * win. A config that no workspace lists is its own root. Both are pure functions
 * of the file system, so a parse worker reaches the same answer as the analyzer.
 */
export const DENO_CONFIG_NAMES = ['deno.json', 'deno.jsonc'] as const;

/** One import map: bare or URL keys to targets, and the scopes that override it. */
export interface DenoImportMap {
  /**
   * Key to target. A target written relative to the map (`./src/`) is stored
   * ABSOLUTE; `jsr:`, `npm:`, `node:` and URL targets are stored as written.
   */
  readonly imports: ReadonlyMap<string, string>;
  /** Scope prefix (an absolute directory with a trailing separator, or a URL) to its map. */
  readonly scopes: ReadonlyArray<{ readonly prefix: string; readonly imports: ReadonlyMap<string, string> }>;
}

export interface DenoConfig {
  /** Absolute path of the `deno.json` / `deno.jsonc`. */
  readonly path: string;
  readonly dir: string;
  /** `name` as published (`@scope/pkg`), or `''`. */
  readonly name: string;
  readonly version: string;
  /** Export subpath (`.`, `./ids`) to the absolute file it names. */
  readonly exports: ReadonlyMap<string, string>;
  readonly importMap: DenoImportMap;
  /** Absolute member directories, for a workspace root; empty otherwise. */
  readonly workspaceMembers: readonly string[];
  /** `"vendor": true`: remote modules are kept under `<dir>/vendor`. */
  readonly vendor: boolean;
  /** `false` when the config turns the lockfile off; the path otherwise (it may not exist). */
  readonly lockPath: string | false;
  readonly compilerOptions: Readonly<Record<string, unknown>>;
}

export interface DenoContext {
  /** The config nearest the file. */
  readonly member: DenoConfig;
  /** The workspace root that lists `member`, or `member` itself. */
  readonly root: DenoConfig;
  /** Every member of `root`'s workspace, `root` included when it has a name. */
  readonly members: readonly DenoConfig[];
}

const parsedConfigs = new Map<string, DenoConfig | null>();
const contextByDir = new Map<string, DenoContext | null>();

/** The Deno config governing `absoluteFilePath`, or `undefined` outside any Deno project. */
export function denoContextFor(absoluteFilePath: string): DenoContext | undefined {
  return denoContextForDir(path.dirname(path.resolve(absoluteFilePath)));
}

export function denoContextForDir(directory: string): DenoContext | undefined {
  const dir = path.resolve(directory);
  const cached = contextByDir.get(dir);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  let result: DenoContext | undefined;
  const memberPath = findConfigUpward(dir);
  const member = memberPath === undefined ? undefined : readDenoConfig(memberPath);
  if (member !== undefined) {
    let root: DenoConfig = member;
    // The workspace root is an ANCESTOR config that lists this member's directory.
    let up = path.dirname(member.dir);
    for (;;) {
      const candidatePath = findConfigUpward(up);
      if (candidatePath === undefined) {
        break;
      }
      const candidate = readDenoConfig(candidatePath);
      if (candidate !== undefined && candidate.workspaceMembers.some((m) => samePath(m, member.dir))) {
        root = candidate;
        break;
      }
      const parent = path.dirname(path.dirname(candidatePath));
      if (parent === path.dirname(candidatePath)) {
        break;
      }
      up = parent;
    }
    const members = root.workspaceMembers
      .map((m) => {
        const p = configIn(m);
        return p === undefined ? undefined : readDenoConfig(p);
      })
      .filter((c): c is DenoConfig => c !== undefined);
    if (root.name !== '' && !members.some((m) => samePath(m.path, root.path))) {
      members.push(root);
    }
    if (member.name !== '' && !members.some((m) => samePath(m.path, member.path))) {
      members.push(member);
    }
    result = { member, root, members };
  }
  contextByDir.set(dir, result ?? null);
  return result;
}

/** The Deno config file directly in `dir`, if any. */
export function configIn(dir: string): string | undefined {
  for (const name of DENO_CONFIG_NAMES) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function findConfigUpward(start: string): string | undefined {
  let dir = start;
  for (;;) {
    const found = configIn(dir);
    if (found !== undefined) {
      return found;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

/** JSON with comments and trailing commas, which is what `deno.jsonc` (and often `deno.json`) holds. */
export function readJsonc(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
  const parsed = ts.parseConfigFileTextToJson(file, text);
  return parsed.error ? undefined : parsed.config;
}

export function readDenoConfig(configPath: string): DenoConfig | undefined {
  const absolute = path.resolve(configPath);
  const cached = parsedConfigs.get(absolute);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  const raw = readJsonc(absolute);
  let result: DenoConfig | undefined;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const json = raw as Record<string, unknown>;
    const dir = path.dirname(absolute);
    const inline = importMapOf(json, dir);
    const external = typeof json.importMap === 'string'
      ? importMapFile(path.resolve(dir, json.importMap))
      : undefined;
    result = {
      path: absolute,
      dir,
      name: typeof json.name === 'string' ? json.name : '',
      version: typeof json.version === 'string' ? json.version : '',
      exports: exportsOf(json.exports, dir),
      importMap: {
        imports: new Map([...(external?.imports ?? []), ...inline.imports]),
        scopes: [...inline.scopes, ...(external?.scopes ?? [])],
      },
      workspaceMembers: workspaceMembersOf(json.workspace, dir),
      vendor: json.vendor === true,
      lockPath: lockPathOf(json.lock, dir),
      compilerOptions: json.compilerOptions !== null && typeof json.compilerOptions === 'object'
        ? json.compilerOptions as Record<string, unknown>
        : {},
    };
  }
  parsedConfigs.set(absolute, result ?? null);
  return result;
}

function importMapFile(file: string): DenoImportMap | undefined {
  const raw = readJsonc(file);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  return importMapOf(raw as Record<string, unknown>, path.dirname(file));
}

function importMapOf(json: Record<string, unknown>, baseDir: string): DenoImportMap {
  const scopes: Array<{ prefix: string; imports: ReadonlyMap<string, string> }> = [];
  if (json.scopes !== null && typeof json.scopes === 'object') {
    for (const [prefix, map] of Object.entries(json.scopes as Record<string, unknown>)) {
      if (map !== null && typeof map === 'object') {
        scopes.push({ prefix: absoluteTarget(prefix, baseDir), imports: entriesOf(map, baseDir) });
      }
    }
    // The most specific scope is consulted first, as the import-map spec orders them.
    scopes.sort((a, b) => b.prefix.length - a.prefix.length);
  }
  return { imports: entriesOf(json.imports, baseDir), scopes };
}

function entriesOf(value: unknown, baseDir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, target] of Object.entries(value as Record<string, unknown>)) {
      if (typeof target === 'string') {
        out.set(key, absoluteTarget(target, baseDir));
      }
    }
  }
  return out;
}

/** `./src/` beside the map becomes an absolute directory, its trailing separator kept. */
function absoluteTarget(target: string, baseDir: string): string {
  if (target.startsWith('file://')) {
    return withTrailing(target, decodeURIComponent(new URL(target).pathname));
  }
  if (target.startsWith('./') || target.startsWith('../') || target === '.' || target === '..'
    || target.startsWith('/')) {
    return withTrailing(target, path.resolve(baseDir, target));
  }
  return target;
}

function withTrailing(original: string, resolved: string): string {
  return original.endsWith('/') && !resolved.endsWith(path.sep) ? resolved + path.sep : resolved;
}

function exportsOf(value: unknown, dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === 'string') {
    out.set('.', path.resolve(dir, value));
  } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [subpath, target] of Object.entries(value as Record<string, unknown>)) {
      if (typeof target === 'string') {
        out.set(subpath, path.resolve(dir, target));
      }
    }
  }
  return out;
}

function workspaceMembersOf(value: unknown, dir: string): string[] {
  const listed = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object' && Array.isArray((value as { members?: unknown }).members)
      ? (value as { members: unknown[] }).members
      : [];
  const out: string[] = [];
  for (const entry of listed) {
    if (typeof entry !== 'string') {
      continue;
    }
    if (entry.endsWith('/*') || entry.endsWith('/*/')) {
      // `./packages/*`: every directory under it that holds a Deno config.
      const parent = path.resolve(dir, entry.replace(/\/\*\/?$/, ''));
      let children: fs.Dirent[] = [];
      try {
        children = fs.readdirSync(parent, { withFileTypes: true });
      } catch {
        // a glob over a missing directory names no member
      }
      for (const child of children) {
        if (child.isDirectory() && configIn(path.join(parent, child.name)) !== undefined) {
          out.push(path.join(parent, child.name));
        }
      }
    } else {
      out.push(path.resolve(dir, entry));
    }
  }
  return out;
}

function lockPathOf(value: unknown, dir: string): string | false {
  if (value === false) {
    return false;
  }
  if (typeof value === 'string') {
    return path.resolve(dir, value);
  }
  if (value !== null && typeof value === 'object' && typeof (value as { path?: unknown }).path === 'string') {
    return path.resolve(dir, (value as { path: string }).path);
  }
  return path.join(dir, 'deno.lock');
}

/** Forgets every parsed config; for a test that rewrites one in place. */
export function clearDenoConfigCache(): void {
  parsedConfigs.clear();
  contextByDir.clear();
}

/**
 * Whether `parent/name` is the `vendor/` directory a Deno config beside it keeps
 * its downloaded modules in. Those are third-party sources: walking them as
 * project files would put every vendored package in the project's own graph.
 */
export function isDenoVendorDirectory(parent: string, name: string): boolean {
  if (name !== 'vendor') {
    return false;
  }
  const config = configIn(parent);
  return config !== undefined && readDenoConfig(config)?.vendor === true;
}
