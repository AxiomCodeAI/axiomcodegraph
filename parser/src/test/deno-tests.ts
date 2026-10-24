/**
 * DENO TESTS: module resolution for TypeScript in a Deno project.
 *
 *     npx tsx src/test/deno-tests.ts            # everything
 *     npx tsx src/test/deno-tests.ts --list     # what runs, and what it proves
 *
 * NO DENO, NO NETWORK. Each check builds a throwaway project, and a fake
 * `$DENO_DIR` laid out exactly as Deno 2 writes one (remote modules under
 * `remote/https/<host>/<sha256(path)>` with the `// denoCacheMetadata=` trailer,
 * npm packages unpacked under `npm/registry.npmjs.org/<name>/<version>`), then
 * runs the real resolver or the real extraction over it.
 *
 * The expected answers are what `deno info --json` reported for the same layouts
 * on Deno 2.9: an import-map key that maps a package also serves its subpaths, a
 * member's map wins over the root's, the lockfile's pinned version wins over a
 * newer cached one, and a workspace member is reached by its `name` through its
 * `exports`.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { extractProject } from '@/extract';
import { clearDenoCacheState } from '@/parsers/typescript/deno/deno-cache';
import { clearDenoConfigCache } from '@/parsers/typescript/deno/deno-config';
import { clearDenoResolutionCache, resolveDenoSpecifier } from '@/parsers/typescript/deno/deno-resolver';
import { compareVersions, maxSatisfying, satisfies } from '@/parsers/typescript/deno/deno-semver';
import { ProjectLanguage } from '@/types/ProjectInfo';
import { ProjectScanner } from '@/utils/project-scanner';

interface Check {
  name: string;
  proves: string;
  rulesOut: string;
  run: (tmp: string) => Promise<string | null>;
}

function write(root: string, files: Record<string, string>): string {
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return root;
}

/** A module in the fake `$DENO_DIR` remote cache, keyed as Deno keys it. */
function cacheRemote(denoDir: string, url: string, body: string, headers: Record<string, string> = {}): void {
  const u = new URL(url);
  const file = path.join(denoDir, 'remote', u.protocol.replace(':', ''), u.hostname,
    crypto.createHash('sha256').update(u.pathname + u.search).digest('hex'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${body}\n// denoCacheMetadata=${JSON.stringify({ headers, url, time: 0 })}`);
}

/** A jsr package version in the fake cache: its `_meta.json` and every file given. */
function cacheJsr(denoDir: string, name: string, version: string, exports: Record<string, string>,
  files: Record<string, string>): void {
  const manifest: Record<string, unknown> = {};
  for (const [file, body] of Object.entries(files)) {
    cacheRemote(denoDir, `https://jsr.io/${name}/${version}/${file}`, body,
      { 'content-type': 'text/typescript' });
    manifest[`/${file}`] = { size: body.length, checksum: '' };
  }
  cacheRemote(denoDir, `https://jsr.io/${name}/${version}_meta.json`, JSON.stringify({ manifest, exports }));
}

function cacheJsrIndex(denoDir: string, name: string, versions: Record<string, { yanked?: boolean }>): void {
  cacheRemote(denoDir, `https://jsr.io/${name}/meta.json`, JSON.stringify({ versions }));
}

/** Points the resolver at a fresh fake `$DENO_DIR` and mirror for one check. */
function freshEnvironment(tmp: string, name: string): { denoDir: string; mirror: string } {
  const denoDir = path.join(tmp, `${name}-deno-dir`);
  const mirror = path.join(tmp, `${name}-mirror`);
  fs.mkdirSync(denoDir, { recursive: true });
  process.env.DENO_DIR = denoDir;
  process.env.AXIOMCODE_DENO_MIRROR = mirror;
  clearDenoConfigCache();
  clearDenoCacheState();
  clearDenoResolutionCache();
  return { denoDir, mirror };
}

function relativeTo(root: string, file: string | undefined): string {
  return file === undefined ? '<none>' : path.relative(root, file).split(path.sep).join('/');
}

function expectResolved(root: string, specifier: string, from: string, want: string, kind?: string): string | null {
  const got = resolveDenoSpecifier(specifier, path.join(root, from));
  const rel = relativeTo(root, got?.resolvedFileName);
  if (rel !== want) {
    return `${specifier} from ${from}: resolved to ${rel}, expected ${want}`;
  }
  if (kind !== undefined && got?.kind !== kind) {
    return `${specifier} from ${from}: kind ${got?.kind}, expected ${kind}`;
  }
  return null;
}

function firstFailure(results: Array<string | null>): string | null {
  return results.find((r) => r !== null) ?? null;
}

function readRows(file: string): Record<string, string>[] {
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter((l) => l !== '');
  const header = lines[0]!.split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

const CHECKS: Check[] = [
  {
    name: 'semver ranges pick what Deno picks',
    proves: 'caret, tilde, partial, comparator and || ranges match the npm semantics Deno uses',
    rulesOut: 'a resolver that takes the first or newest version regardless of the written range',
    run: async () => {
      const cases: Array<[string, string, boolean]> = [
        ['1.1.6', '^1.0.0', true], ['2.0.0', '^1.0.0', false], ['0.2.5', '^0.2.1', true],
        ['0.3.0', '^0.2.1', false], ['1.2.9', '~1.2.3', true], ['1.3.0', '~1.2.3', false],
        ['4.13.13', '4', true], ['4.13.13', '4.12', false], ['3.25.76', '>=3.23 <4', true],
        ['1.0.0-rc.1', '^1.0.0', false], ['1.0.0-rc.2', '^1.0.0-rc.1', true], ['5.0.0', '^4 || ^5', true],
        ['1.2.3', '1.2.3', true], ['1.2.4', '', true], ['1.5.0', '1.2 - 1.4', false],
      ];
      for (const [version, range, want] of cases) {
        if (satisfies(version, range) !== want) {
          return `satisfies(${version}, "${range}") should be ${want}`;
        }
      }
      if (maxSatisfying(['1.0.0', '1.1.6', '2.0.0'], '^1.0.0') !== '1.1.6') {
        return 'maxSatisfying did not pick the highest in-range version';
      }
      if (compareVersions('1.0.0-rc.1', '1.0.0') >= 0) {
        return 'a pre-release must sort before its release';
      }
      return null;
    },
  },
  {
    name: 'import map: keys, prefixes, package subpaths and scopes',
    proves: 'exact keys, the longest `prefix/` key, Deno\'s package-subpath extension, scopes and an external importMap file',
    rulesOut: 'a map applied as an exact lookup only, so `@/x.ts` and `hono/cors` stay unresolved',
    run: async (tmp) => {
      freshEnvironment(tmp, 'map');
      const root = write(path.join(tmp, 'map'), {
        'deno.json': JSON.stringify({
          imports: { '@/': './src/', 'util': './src/util.ts', 'lib/': './lib/', 'lib/deep/': './deeper/' },
          scopes: { './legacy/': { 'util': './legacy/old-util.ts' } },
          importMap: './extra-map.json',
        }),
        'extra-map.json': JSON.stringify({ imports: { 'extra': './src/extra.ts' } }),
        'src/main.ts': '', 'src/util.ts': '', 'src/extra.ts': '', 'src/a.ts': '',
        'lib/x.ts': '', 'deeper/y.ts': '', 'legacy/caller.ts': '', 'legacy/old-util.ts': '',
      });
      return firstFailure([
        expectResolved(root, '@/a.ts', 'src/main.ts', 'src/a.ts', 'IMPORT_MAP'),
        expectResolved(root, 'util', 'src/main.ts', 'src/util.ts'),
        expectResolved(root, 'lib/x.ts', 'src/main.ts', 'lib/x.ts'),
        expectResolved(root, 'lib/deep/y.ts', 'src/main.ts', 'deeper/y.ts'),
        expectResolved(root, 'util', 'legacy/caller.ts', 'legacy/old-util.ts'),
        expectResolved(root, 'extra', 'src/main.ts', 'src/extra.ts'),
        // Relative specifiers are the compiler's, never the map's.
        expectResolved(root, './a.ts', 'src/main.ts', '<none>'),
      ]);
    },
  },
  {
    name: 'workspace: members by name, member map over root map',
    proves: 'a member is reached by its name and its export subpaths, and a member\'s own import map wins over the root\'s',
    rulesOut: 'a workspace analysed as unrelated programs, or a root map that shadows a member\'s entry',
    run: async (tmp) => {
      freshEnvironment(tmp, 'ws');
      const root = write(path.join(tmp, 'ws'), {
        'deno.json': JSON.stringify({ workspace: ['./api', './packages/*'], imports: { 'cfg': './root-cfg.ts' } }),
        'root-cfg.ts': '',
        'api/deno.json': JSON.stringify({ name: '@acme/api', imports: { 'cfg': './src/cfg.ts' } }),
        'api/src/main.ts': '', 'api/src/cfg.ts': '',
        'packages/shared/deno.json': JSON.stringify({ name: '@acme/shared', exports: { '.': './mod.ts', './ids': './src/ids.ts' } }),
        'packages/shared/mod.ts': '', 'packages/shared/src/ids.ts': '',
        'packages/other/deno.json': JSON.stringify({ name: '@acme/other', exports: './index.ts' }),
        'packages/other/index.ts': '',
      });
      const scanned = await new ProjectScanner().scanForProjects(root);
      const tsProjects = scanned.filter((p) => p.language === ProjectLanguage.TYPESCRIPT);
      if (tsProjects.length !== 1) {
        return `the workspace was discovered as ${tsProjects.length} TypeScript projects, expected 1`;
      }
      return firstFailure([
        expectResolved(root, '@acme/shared', 'api/src/main.ts', 'packages/shared/mod.ts', 'WORKSPACE_MEMBER'),
        expectResolved(root, '@acme/shared/ids', 'api/src/main.ts', 'packages/shared/src/ids.ts'),
        expectResolved(root, '@acme/other', 'api/src/main.ts', 'packages/other/index.ts'),
        expectResolved(root, 'jsr:@acme/shared@^0.1.0', 'api/src/main.ts', 'packages/shared/mod.ts'),
        expectResolved(root, 'cfg', 'api/src/main.ts', 'api/src/cfg.ts'),
        expectResolved(root, 'cfg', 'packages/shared/mod.ts', 'root-cfg.ts'),
        expectResolved(root, '@acme/shared/missing', 'api/src/main.ts', '<none>'),
      ]);
    },
  },
  {
    name: 'jsr: the locked version, its exports, and what it imports',
    proves: 'the lockfile pins the version over a newer cached one, exports name the file, and the mirror receives the module and its transitive imports',
    rulesOut: 'resolving to the newest cached version, ignoring exports, or a mirror with only the entry file',
    run: async (tmp) => {
      const { denoDir, mirror } = freshEnvironment(tmp, 'jsr');
      cacheJsr(denoDir, '@std/path', '1.1.6', { '.': './mod.ts', './join': './join.ts' }, {
        'mod.ts': 'export * from "./join.ts";\nimport { os } from "jsr:@std/internal@^1.0.0/os";\n',
        'join.ts': 'import { assertPath } from "./_common/assert_path.ts";\nexport function join() {}\n',
        '_common/assert_path.ts': 'export function assertPath() {}\n',
      });
      cacheJsr(denoDir, '@std/path', '1.2.0', { '.': './mod.ts' }, { 'mod.ts': 'export const newer = 1;\n' });
      cacheJsr(denoDir, '@std/internal', '1.0.14', { './os': './os.ts' }, { 'os.ts': 'export const os = "x";\n' });
      const root = write(path.join(tmp, 'jsr'), {
        'deno.json': JSON.stringify({ imports: { '@std/path': 'jsr:@std/path@^1.0.0' } }),
        // v5 layout: `jsr` at the top level.
        'deno.lock': JSON.stringify({ version: '5', jsr: { '@std/path@1.1.6': {}, '@std/internal@1.0.14': {} } }),
        'main.ts': '',
      });
      const failure = firstFailure([
        expectResolved(root, '@std/path', 'main.ts', relativeTo(root, path.join(mirror, 'jsr.io/@std/path/1.1.6/mod.ts')), 'JSR'),
        expectResolved(root, '@std/path/join', 'main.ts', relativeTo(root, path.join(mirror, 'jsr.io/@std/path/1.1.6/join.ts'))),
        expectResolved(root, 'jsr:@std/path@^1.0.0/join', 'main.ts', relativeTo(root, path.join(mirror, 'jsr.io/@std/path/1.1.6/join.ts'))),
        expectResolved(root, 'jsr:@std/path@^1.0.0/missing', 'main.ts', '<none>'),
        expectResolved(root, 'jsr:@std/absent@1', 'main.ts', '<none>'),
      ]);
      if (failure) {
        return failure;
      }
      for (const copied of ['jsr.io/@std/path/1.1.6/_common/assert_path.ts', 'jsr.io/@std/internal/1.0.14/os.ts', 'deno.lock']) {
        if (!fs.existsSync(path.join(mirror, copied))) {
          return `the mirror is missing ${copied}`;
        }
      }
      if (fs.existsSync(path.join(mirror, 'jsr.io/@std/path/1.2.0'))) {
        return 'a version the lockfile does not pin was copied to the mirror';
      }
      return null;
    },
  },
  {
    name: 'jsr: without a lockfile, the highest cached version in range',
    proves: 'with no lockfile the range picks among cached versions, skipping yanked ones and ones never downloaded',
    rulesOut: 'refusing every jsr import in a project with "lock": false',
    run: async (tmp) => {
      const { denoDir, mirror } = freshEnvironment(tmp, 'nolock');
      cacheJsrIndex(denoDir, '@hono/hono', { '4.6.0': {}, '4.7.0': {}, '4.8.0': { yanked: true }, '4.9.0': {}, '5.0.0': {} });
      cacheJsr(denoDir, '@hono/hono', '4.6.0', { '.': './src/index.ts' }, { 'src/index.ts': 'export class Hono {}\n' });
      cacheJsr(denoDir, '@hono/hono', '4.7.0', { '.': './src/index.ts', './cors': './src/cors.ts' },
        { 'src/index.ts': 'export class Hono {}\n', 'src/cors.ts': 'export function cors() {}\n' });
      cacheJsr(denoDir, '@hono/hono', '4.8.0', { '.': './src/index.ts' }, { 'src/index.ts': '' });
      cacheJsr(denoDir, '@hono/hono', '5.0.0', { '.': './src/index.ts' }, { 'src/index.ts': '' });
      const root = write(path.join(tmp, 'nolock'), {
        'deno.jsonc': '{\n  // comments and trailing commas, as deno.jsonc allows\n  "lock": false,\n  "imports": { "hono": "jsr:@hono/hono@^4.6.0", },\n}\n',
        'main.ts': '',
      });
      return firstFailure([
        expectResolved(root, 'hono', 'main.ts', relativeTo(root, path.join(mirror, 'jsr.io/@hono/hono/4.7.0/src/index.ts'))),
        expectResolved(root, 'hono/cors', 'main.ts', relativeTo(root, path.join(mirror, 'jsr.io/@hono/hono/4.7.0/src/cors.ts'))),
      ]);
    },
  },
  {
    name: 'npm: node_modules first, then Deno\'s npm cache through exports',
    proves: 'an npm: import resolves into node_modules when installed there, else into $DENO_DIR/npm through the package\'s exports and types',
    rulesOut: 'npm: specifiers left unresolved, or a cache lookup that ignores the package\'s own exports map',
    run: async (tmp) => {
      const { denoDir } = freshEnvironment(tmp, 'npm');
      const pkg = path.join(denoDir, 'npm', 'registry.npmjs.org', 'zod', '3.25.76');
      write(pkg, {
        'package.json': JSON.stringify({ name: 'zod', version: '3.25.76', exports: { '.': { types: './index.d.ts', import: './index.js' }, './v4': { types: './v4/index.d.ts' } } }),
        'index.d.ts': 'export declare const z: unknown;\n', 'index.js': '', 'v4/index.d.ts': '',
        'v4/package.json': JSON.stringify({ name: 'zod-v4-stub' }),
      });
      write(path.join(denoDir, 'npm', 'registry.npmjs.org', 'zod', '4.0.0'), {
        'package.json': JSON.stringify({ name: 'zod', version: '4.0.0', types: './index.d.ts' }), 'index.d.ts': '',
      });
      const root = write(path.join(tmp, 'npm'), {
        'deno.json': JSON.stringify({ imports: { 'zod': 'npm:zod@^3.23.0' } }),
        'deno.lock': JSON.stringify({ version: '4', npm: { 'zod@3.25.76': {} } }),
        'main.ts': '',
        'installed/deno.json': '{}',
        'installed/node_modules/left-pad/package.json': JSON.stringify({ name: 'left-pad', types: './index.d.ts' }),
        'installed/node_modules/left-pad/index.d.ts': '',
        'installed/main.ts': '',
      });
      return firstFailure([
        expectResolved(root, 'zod', 'main.ts', relativeTo(root, path.join(pkg, 'index.d.ts')), 'NPM_CACHE'),
        expectResolved(root, 'zod/v4', 'main.ts', relativeTo(root, path.join(pkg, 'v4/index.d.ts'))),
        expectResolved(root, 'npm:zod@4', 'main.ts',
          relativeTo(root, path.join(denoDir, 'npm', 'registry.npmjs.org', 'zod', '4.0.0', 'index.d.ts'))),
        expectResolved(root, 'npm:left-pad@1', 'installed/main.ts', 'installed/node_modules/left-pad/index.d.ts', 'NODE_MODULES'),
        expectResolved(root, 'npm:absent@1', 'main.ts', '<none>'),
      ]);
    },
  },
  {
    name: 'https: redirects, x-typescript-types and extensionless URLs',
    proves: 'a URL import follows cached redirects, prefers the declarations a CDN points at, and gets an extension from its content type',
    rulesOut: 'URL imports left unresolved, or mirrored under a name the parser walk would skip',
    run: async (tmp) => {
      const { denoDir, mirror } = freshEnvironment(tmp, 'remote');
      cacheRemote(denoDir, 'https://deno.land/x/oak/mod.ts', '', { location: '/x/oak@v12.6.1/mod.ts' });
      // `export * as` is the re-export form the compiler's light pre-processor does not report.
      cacheRemote(denoDir, 'https://deno.land/x/oak@v12.6.1/mod.ts', 'export * as app from "./app.ts";\n',
        { 'content-type': 'application/typescript' });
      cacheRemote(denoDir, 'https://deno.land/x/oak@v12.6.1/app.ts', 'export class Application {}\n',
        { 'content-type': 'application/typescript' });
      cacheRemote(denoDir, 'https://esm.sh/preact@10.19.0', 'export {}\n',
        { 'content-type': 'application/javascript', 'x-typescript-types': 'https://esm.sh/preact@10.19.0/src/index.d.ts' });
      cacheRemote(denoDir, 'https://esm.sh/preact@10.19.0/src/index.d.ts', 'export declare function h(): void;\n',
        { 'content-type': 'application/typescript' });
      const root = write(path.join(tmp, 'remote'), { 'deno.json': '{}', 'main.ts': '' });
      const failure = firstFailure([
        expectResolved(root, 'https://deno.land/x/oak/mod.ts', 'main.ts',
          relativeTo(root, path.join(mirror, 'deno.land/x/oak@v12.6.1/mod.ts')), 'REMOTE'),
        expectResolved(root, 'https://esm.sh/preact@10.19.0', 'main.ts',
          relativeTo(root, path.join(mirror, 'esm.sh/preact@10.19.0/src/index.d.ts'))),
        expectResolved(root, 'https://deno.land/x/never-downloaded/mod.ts', 'main.ts', '<none>'),
      ]);
      if (failure) {
        return failure;
      }
      return fs.existsSync(path.join(mirror, 'deno.land/x/oak@v12.6.1/app.ts'))
        ? null
        : 'a relative import of a mirrored URL module was not copied';
    },
  },
  {
    name: 'outside a Deno project nothing changes',
    proves: 'with no deno.json above a file the resolver answers nothing, so every other TypeScript project resolves as before',
    rulesOut: 'Deno rules leaking into Node projects, such as an unrelated import map or a stray mirror write',
    run: async (tmp) => {
      const { mirror } = freshEnvironment(tmp, 'node');
      const root = write(path.join(tmp, 'node'), {
        'package.json': JSON.stringify({ name: 'node-app' }),
        'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext' } }),
        'src/main.ts': '',
      });
      for (const specifier of ['hono', 'npm:zod@3', 'jsr:@std/path', 'https://deno.land/x/oak/mod.ts', '@/a.ts']) {
        if (resolveDenoSpecifier(specifier, path.join(root, 'src/main.ts')) !== undefined) {
          return `${specifier} was answered in a project with no deno.json`;
        }
      }
      return fs.existsSync(mirror) ? 'a mirror was written for a project with no deno.json' : null;
    },
  },
  {
    name: 'extraction: import rows, links and the vendor directory',
    proves: 'ts_import carries the Deno resolution kinds and module links, unresolved jsr: rows still name their package, and vendor/ is not walked as project source',
    rulesOut: 'a resolver that is right in isolation but never reaches the rows the engine reads',
    run: async (tmp) => {
      const { denoDir } = freshEnvironment(tmp, 'extract');
      cacheJsr(denoDir, '@std/path', '1.1.6', { '.': './mod.ts' }, { 'mod.ts': 'export function join() {}\n' });
      const root = write(path.join(tmp, 'extract'), {
        'deno.json': JSON.stringify({ workspace: ['./api', './shared'], vendor: true, imports: { '@std/path': 'jsr:@std/path@^1.0.0' } }),
        'deno.lock': JSON.stringify({ version: '5', jsr: { '@std/path@1.1.6': {} } }),
        'api/deno.json': JSON.stringify({ name: '@acme/api', imports: { '@/': './src/', 'gone': 'jsr:@std/gone@^1.0.0' } }),
        'api/src/main.ts': [
          'import { join } from "@std/path";',
          'import { formatUser } from "@acme/shared";',
          'import { audit } from "@/audit.ts";',
          'import { lost } from "gone";',
          'export function main() { audit(formatUser(join())); lost(); }',
        ].join('\n'),
        'api/src/audit.ts': 'export function audit(m: string): void {}\n',
        'shared/deno.json': JSON.stringify({ name: '@acme/shared', exports: './mod.ts' }),
        'shared/mod.ts': 'export { formatUser } from "@acme/shared/format";\n',
        'shared/format.ts': 'export function formatUser(n: string): string { return n; }\n',
        'vendor/jsr.io/@std/path/1.1.6/mod.ts': 'export function join() {}\n',
      });
      // The member exports its own subpath, which the barrel above re-exports by name.
      write(root, { 'shared/deno.json': JSON.stringify({ name: '@acme/shared', exports: { '.': './mod.ts', './format': './format.ts' } }) });
      clearDenoConfigCache();
      const out = path.join(tmp, 'extract-ir');
      await extractProject({ projectPath: root, versionLink: 'v1', outputDir: out, layout: 'per-language' });
      const imports = readRows(path.join(out, 'typescript', 'all-typescript-imports.csv'));
      const byPath = new Map(imports.map((r) => [r.importedPath, r]));
      const want: Array<[string, string, boolean, string]> = [
        ['@std/path', 'JSR_PACKAGE', false, '@std/path'],
        ['@acme/shared', 'WORKSPACE_PACKAGE', true, '@acme/shared'],
        ['@/audit.ts', 'PATHS_ALIAS', true, ''],
        ['gone', 'UNRESOLVED', false, '@std/gone'],
      ];
      for (const [specifier, kind, linked, packageName] of want) {
        const row = byPath.get(specifier);
        if (row === undefined) {
          return `no ts_import row for ${specifier}`;
        }
        if (row.resolutionKind !== kind) {
          return `${specifier}: resolutionKind ${row.resolutionKind}, expected ${kind}`;
        }
        if ((row.resolvedModuleLinkHash !== '') !== linked) {
          return `${specifier}: module link ${row.resolvedModuleLinkHash === '' ? 'missing' : 'present'}, expected ${linked ? 'present' : 'missing'}`;
        }
        if (row.packageName !== packageName) {
          return `${specifier}: packageName "${row.packageName}", expected "${packageName}"`;
        }
      }
      const modules = readRows(path.join(out, 'typescript', 'all-typescript-modules.csv'));
      if (modules.some((m) => (m.filePath ?? '').startsWith('vendor/'))) {
        return 'vendor/ was walked as project source';
      }
      const exports = readRows(path.join(out, 'typescript', 'all-typescript-exports.csv'));
      const reExport = exports.find((e) => e.sourceSpecifier === '@acme/shared/format');
      if (reExport === undefined || reExport.resolvedSourceModuleLinkHash === '') {
        return 'a barrel re-exporting a workspace member by name was not linked to the member\'s module';
      }
      const strictRow = modules.find((m) => m.filePath === 'api/src/main.ts');
      if (strictRow?.moduleResolutionMode !== 'BUNDLER') {
        return `a Deno file compiled under ${strictRow?.moduleResolutionMode}, expected BUNDLER`;
      }
      return null;
    },
  },
];

async function main(): Promise<number> {
  if (process.argv.includes('--list')) {
    for (const c of CHECKS) console.log(`${c.name}\n  proves: ${c.proves}\n  rules out: ${c.rulesOut}`);
    return 0;
  }
  // Real path: the compiler resolves through symlinks, and macOS's temp dir is one.
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deno-tests-')));
  const saved = { DENO_DIR: process.env.DENO_DIR, AXIOMCODE_DENO_MIRROR: process.env.AXIOMCODE_DENO_MIRROR };
  let failed = 0;
  try {
    for (const check of CHECKS) {
      let result: string | null;
      try {
        result = await check.run(tmp);
      } catch (e) {
        result = `threw: ${(e as Error).stack ?? String(e)}`;
      }
      console.log(`${result === null ? 'PASS' : 'FAIL'}  ${check.name}`);
      if (result !== null) {
        console.log(`      ${result}`);
        failed += 1;
      }
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${CHECKS.length - failed}/${CHECKS.length} Deno checks passed`);
  return failed ? 1 : 0;
}

void main().then((code) => process.exit(code));
