/**
 * The library roots a Deno project's imports reach, for `--library auto`:
 *
 *   node dist/deno-libraries.js <repo>
 *
 * prints one JSON object, `{"mirrors": ["<dir>", …], "packages": ["<dir>", …]}`:
 *
 *   mirrors   each Deno project's mirror, filled by resolving every import: each
 *             `jsr:` and URL module the project reaches, and what those import,
 *             copied from Deno's cache as `vendor/` lays them out
 *   packages  every npm package directory an `npm:` import resolved into, in
 *             Deno's npm cache or `node_modules` (real paths, because Deno's
 *             `node_modules` entries are symlinks into `node_modules/.deno`)
 *
 * Library discovery runs BEFORE the project is parsed, so the mirror has to be
 * filled here rather than as a side effect of the parse. Resolution is the same
 * code the parser uses, so the files staged are the files the imports name.
 * A repository with no Deno config prints `{"mirrors": [], "packages": []}`.
 */
import * as fs from 'fs';
import * as path from 'path';

import { configIn, denoContextForDir, isDenoVendorDirectory } from '@/parsers/typescript/deno/deno-config';
import { mirrorRoot } from '@/parsers/typescript/deno/deno-cache';
import { moduleSpecifiersOf, resolveDenoSpecifier } from '@/parsers/typescript/deno/deno-resolver';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.axiomcode']);
const SOURCE = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/;

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !entry.name.startsWith('.') && !isDenoVendorDirectory(dir, entry.name)) {
          walk(full);
        }
      } else if (SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * `<…>/zod/3.25.76` for a file inside it: the nearest ancestor whose package.json
 * names `packageName`. Nearest alone is not enough, because a package can ship a
 * stub package.json per subpath (`zod/v4/package.json`).
 */
function packageDirOf(file: string, packageName: string): string | undefined {
  let dir = path.dirname(file);
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      let name: unknown;
      try {
        name = (JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { name?: unknown }).name;
      } catch {
        name = undefined;
      }
      if (name === packageName) {
        try {
          return fs.realpathSync(dir);
        } catch {
          return dir;
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function main(): number {
  const repo = path.resolve(process.argv[2] ?? '.');
  const mirrors = new Set<string>();
  const packages = new Set<string>();
  for (const file of sourceFiles(repo)) {
    const context = denoContextForDir(path.dirname(file));
    if (context === undefined) {
      continue;
    }
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const specifier of moduleSpecifiersOf(text, file)) {
      const resolved = resolveDenoSpecifier(specifier, file);
      if (resolved === undefined) {
        continue;
      }
      if (resolved.kind === 'JSR' || resolved.kind === 'REMOTE') {
        mirrors.add(mirrorRoot(context.root));
      } else if (resolved.kind === 'NPM_CACHE' || resolved.kind === 'NODE_MODULES') {
        const dir = packageDirOf(resolved.resolvedFileName, resolved.packageName);
        if (dir !== undefined) {
          packages.add(dir);
        }
      }
    }
  }
  // A mirror exists once something was copied into it; one that stayed empty stages nothing.
  const filled = [...mirrors].filter((m) => configIn(m) !== undefined).sort();
  process.stdout.write(`${JSON.stringify({ mirrors: filled, packages: [...packages].sort() })}\n`);
  return 0;
}

process.exit(main());
