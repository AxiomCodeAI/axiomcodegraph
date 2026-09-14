#!/usr/bin/env node
/**
 * STAGE A PACKAGE WHOSE OWN tsconfig NAMES NO FILES.
 *
 * The documented `composite` layout puts `files: [], include: [], references: [...]` in a
 * package's tsconfig.json and the real settings in the referenced build config.
 * `run-evaluation.sh` already resolves that delegation for the CLIENT entry project
 * (#351) — but a LIBRARY is staged straight out of `node_modules/<pkg>`, with no such
 * substitution. The parser discovers projects by scanning, so the only config under the
 * package that resolves to any files wins, and on a workspace package that is
 * `test/tsconfig.json`:
 *
 *     staged modules: 80, every one under test/      source .ts files outside test/: 195
 *
 * Measured on a held-out corpus member, that is 359 of its 667 missed sites — 54% —
 * targeting a file that is in no staged IR at all. See #414.
 *
 * This writes a SHADOW COPY of the package with a flat, self-contained tsconfig naming
 * the file set the delegate actually describes. The checkout is never touched, and the
 * caller keeps `.source-root` pointing at the ORIGINAL directory so the identities both
 * sides compare on still join.
 *
 * The file set is resolved by the COMPILER rather than by re-implementing `extends`
 * merging and path rebasing — which is the part that would quietly go wrong.
 *
 * usage: node stage-solution-src.mjs <srcDir> <destDir>
 * exits 1 (and stages nothing) when the package's config names files itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadTypeScript } from '../ground-truth/load-typescript.mjs';

const srcDir = path.resolve(process.argv[2]);
const destDir = path.resolve(process.argv[3]);
const ts = loadTypeScript(srcDir, { toolName: 'stage-solution-src' });

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  .replace(/,(\s*[}\]])/g, '$1');

const entry = path.join(srcDir, 'tsconfig.json');
if (!fs.existsSync(entry)) process.exit(1);
let cfg;
try { cfg = JSON.parse(strip(fs.readFileSync(entry, 'utf8'))); } catch { process.exit(1); }

// A config that names its own files is left alone — this must be inert for every
// ordinary package.
if (((cfg.files || []).length + (cfg.include || []).length) > 0) process.exit(1);
const refs = (cfg.references || []).map((r) => r && r.path).filter(Boolean);
if (refs.length === 0) process.exit(1);

// The first reference that exists and itself describes a file set is the delegate.
let delegate;
for (const r of refs) {
  let rp = path.resolve(srcDir, r);
  try { if (fs.statSync(rp).isDirectory()) rp = path.join(rp, 'tsconfig.json'); } catch { /* not a dir */ }
  if (!fs.existsSync(rp)) continue;
  let d;
  try { d = JSON.parse(strip(fs.readFileSync(rp, 'utf8'))); } catch { continue; }
  if (((d.files || []).length + (d.include || []).length) === 0 && !d.exclude) continue;
  delegate = rp;
  break;
}
if (!delegate) process.exit(1);

const parsed = ts.getParsedCommandLineOfConfigFile(delegate, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: () => {},
  getCurrentDirectory: () => path.dirname(delegate),
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
});
if (!parsed || !parsed.fileNames || parsed.fileNames.length === 0) process.exit(1);

// Only files INSIDE the package are staged. A build config may legitimately reach a
// sibling package through a path mapping, and staging that here would put the same
// declarations in twice under two roots.
const inside = parsed.fileNames
  .map((f) => path.resolve(f))
  .filter((f) => f.startsWith(srcDir + path.sep))
  .map((f) => './' + path.relative(srcDir, f).split(path.sep).join('/'));
if (inside.length === 0) process.exit(1);

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });
for (const rel of inside) {
  const from = path.join(srcDir, rel);
  const to = path.join(destDir, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.copyFileSync(from, to); } catch { /* unreadable file is not fatal */ }
}

// A FLAT config. The extends chain is already collapsed into `parsed.options`, and only
// the options that change what the parser SEES are carried — an inherited `outDir` or
// `rootDir` points outside this copy and means nothing here.
const KEEP = new Set(['target', 'module', 'moduleResolution', 'jsx', 'jsxImportSource',
  'lib', 'strict', 'strictNullChecks', 'strictBindCallApply', 'esModuleInterop',
  'allowSyntheticDefaultImports', 'experimentalDecorators', 'emitDecoratorMetadata',
  'useDefineForClassFields', 'skipLibCheck', 'allowJs', 'resolveJsonModule']);
const opts = {};
for (const [k, v] of Object.entries(parsed.options)) {
  if (!KEEP.has(k)) continue;
  // Enum-valued options come back as numbers; the string form is what a tsconfig takes.
  if (k === 'target' || k === 'module' || k === 'moduleResolution' || k === 'jsx') {
    const table = { target: ts.ScriptTarget, module: ts.ModuleKind,
      moduleResolution: ts.ModuleResolutionKind, jsx: ts.JsxEmit }[k];
    const name = Object.keys(table).find((n) => table[n] === v && Number.isNaN(Number(n)));
    if (name) { opts[k] = name; continue; }
  }
  opts[k] = v;
}
fs.writeFileSync(path.join(destDir, 'tsconfig.json'),
  JSON.stringify({ compilerOptions: opts, files: inside }, null, 2) + '\n');
process.stderr.write(`stage-solution-src: ${inside.length} files via ${path.basename(delegate)}\n`);
process.exit(0);
