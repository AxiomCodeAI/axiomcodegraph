#!/usr/bin/env node
/**
 * Print every tsconfig in a project's `extends` chain, one absolute path per line,
 * nearest first. The project's own config is line one.
 *
 * WHY THIS EXISTS. The harness analyses an rsync MIRROR of the project directory, and a
 * workspace package's tsconfig almost always begins `"extends": "../../tsconfig.base.json"`
 * — a file one or more levels ABOVE the directory being mirrored. The parser then resolves
 * the chain against a file that is not there and silently falls back to each option's
 * default. Measured: a package whose base sets `strict: true` emits
 * `strictBindCallApply = false` for every module when read through the mirror and `true`
 * when read through the real directory. That option decides which of lib.es5's two
 * declarations of `call`/`apply`/`bind` the compiler answers with, so the engine then
 * commits to the wrong one (issue #240).
 *
 * The chain is resolved with the COMPILER's own rules rather than by parsing JSON, because
 * `extends` is not just a relative path: it may be a bare package specifier resolved
 * through node_modules (`@tsconfig/node18/tsconfig.json`), and since TypeScript 5.0 it may
 * be an ARRAY, applied left to right. Hand-rolling that is how a chain gets half-followed.
 *
 * Emitting only CONFIGS, never sources: they are small JSON files, and copying a config's
 * whole directory would drag a sibling package's sources into a mirror that is supposed to
 * contain one project.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { loadTypeScript } from '../ground-truth/load-typescript.mjs';

const plan = process.argv[2] === '--plan';
const start = plan ? process.argv[3] : process.argv[2];
if (!start) {
  console.error('usage: tsconfig_chain.mjs [--plan] <project-dir | tsconfig path>');
  process.exit(2);
}

// Through the shared loader like the rest of the stack: a bare `import ts from
// 'typescript'` resolves to whatever is nearest and dies on a property access if that
// copy is a TypeScript 7, which ships no JavaScript compiler API at all (#239).
const ts = loadTypeScript(path.resolve(start), { toolName: 'tsconfig_chain' });

/** The config a directory is governed by, or the path itself if one was given. */
function entryConfig(p) {
  const abs = path.resolve(p);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  const here = path.join(abs, 'tsconfig.json');
  return fs.existsSync(here) ? here : undefined;
}

const seen = new Set();
const out = [];

/** `extends` is a string or, since TS 5.0, an array applied left to right. */
function extendsList(config) {
  const e = config?.extends;
  if (e === undefined) return [];
  return Array.isArray(e) ? e : [e];
}

function walk(configPath) {
  const abs = path.resolve(configPath);
  if (seen.has(abs)) return;            // a cycle is the project's problem, not ours
  seen.add(abs);
  out.push(abs);

  const read = ts.readConfigFile(abs, ts.sys.readFile);
  if (read.error || read.config === undefined) return;

  for (const spec of extendsList(read.config)) {
    // The compiler's own resolver: handles a relative path, and a bare package
    // specifier reached through node_modules.
    const resolved = ts.nodeModuleNameResolver(
      spec.endsWith('.json') ? spec : `${spec}.json`,
      abs,
      { moduleResolution: ts.ModuleResolutionKind.Node10, resolveJsonModule: true },
      ts.sys,
      undefined,
      undefined,
      ts.Extension.Json,
    )?.resolvedModule?.resolvedFileName;

    let target = resolved;
    if (target === undefined) {
      // Relative or rooted specifiers that the module resolver declines to answer for.
      const direct = path.resolve(path.dirname(abs), spec);
      for (const cand of [direct, `${direct}.json`, path.join(direct, 'tsconfig.json')]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) { target = cand; break; }
      }
    }
    if (target === undefined) {
      // Report, do not throw: an unresolvable extends is exactly what the caller wants
      // to hear about, and it must not take the extraction down with it.
      console.error(`UNRESOLVED\t${spec}\t${abs}`);
      continue;
    }
    walk(target);
  }
}

const entry = entryConfig(start);
if (entry === undefined) {
  // Not an error. A single-package project need not have a tsconfig, and the caller
  // treats "no chain" as "nothing to copy".
  process.exit(0);
}
walk(entry);

if (!plan) {
  for (const p of out) console.log(p);
  process.exit(0);
}

// ── --plan: what the mirror has to look like ────────────────────────────────
// Ancestor configs sit ABOVE the project directory, so a mirror rooted AT the project
// cannot hold them at the relative paths they are referenced by. The plan names a base
// directory deep enough to contain the project and every ancestor, the project's path
// relative to it, and each config to copy. Emitted from here rather than computed in
// shell because it is path arithmetic, and one off-by-one segment silently reproduces
// the bug this is fixing.
//
// Configs under node_modules are NOT copied: the harness symlinks node_modules into the
// mirror, so a bare specifier like `@tsconfig/node20` already resolves. Copying them
// would duplicate a package into the source tree.
const project = path.resolve(fs.statSync(path.resolve(start)).isFile()
  ? path.dirname(path.resolve(start)) : start);

const copyable = out.filter((p) => !p.split(path.sep).includes('node_modules'));
const outside = copyable.filter((p) => !p.startsWith(project + path.sep));

if (outside.length === 0) {
  // Nothing above the project: the existing flat mirror is already correct.
  console.log('BASE\t' + project);
  console.log('REL\t.');
  process.exit(0);
}

function commonDir(dirs) {
  const split = dirs.map((d) => d.split(path.sep));
  const first = split[0];
  let i = 0;
  while (i < first.length && split.every((s) => s[i] === first[i])) i += 1;
  return first.slice(0, i).join(path.sep) || path.sep;
}

const base = commonDir([project, ...outside.map((p) => path.dirname(p))]);
console.log('BASE\t' + base);
console.log('REL\t' + (path.relative(base, project) || '.'));
for (const p of copyable) {
  if (p.startsWith(project + path.sep)) continue;   // already inside the mirrored tree
  console.log('COPY\t' + p + '\t' + path.relative(base, p));
}
