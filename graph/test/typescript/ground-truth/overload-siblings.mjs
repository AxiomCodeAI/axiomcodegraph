#!/usr/bin/env node
/**
 * WHICH DECLARATIONS ARE OVERLOADS OF ONE CALLABLE — asked of the compiler, answered by
 * position.
 *
 * ── THE VERDICT THIS EXISTS TO CORRECT ──────────────────────────────────────
 * `score.py` already has the right rule for this. Its comment states it: "TypeScript
 * overloads are compile-time only: N signatures, ONE implementation, so a call that
 * reaches any of them reaches the same code." Reaching a different overload of the same
 * callable is an ordinary ambiguity, and `OVERLOAD_SIBLING` is the verdict for it.
 *
 * `_same_group` implements that by comparing `declarationGroupKey`, which the parser
 * populates for `FUNCTION_DECLARATION` and for NOTHING ELSE. Measured on one project's
 * own code and on the standard library it stages:
 *
 *     FUNCTION_DECLARATION   243 populated, 0 empty     149 populated, 0 empty
 *     METHOD_DECLARATION       0 populated, 3272 empty
 *     METHOD_SIGNATURE         0 populated,  209 empty  3922 empty
 *     CONSTRUCT_SIGNATURE                                143 empty
 *     ... every other kind     0 populated
 *
 * So an overloaded class METHOD, and every signature kind, is invisible to the credit.
 * The symptom is not a counter stuck at zero — the verdict does fire, 7 times on one
 * project — because function overloads are the one kind with a key. See #310.
 *
 * Two rows in the corpus are scored as the engine naming a target the compiler
 * disagrees with, when it named another overload of the same thing:
 *
 *     addSelect   oracle SelectQueryBuilder.ts:196:5   engine 188:5;201:5
 *                 three overloads of one method in one class
 *     new Set     oracle lib.es2015.iterable.d.ts:235:5
 *                 engine lib.es2015.collection.d.ts:119:5
 *                 two construct signatures of SetConstructor, which the standard
 *                 library declares in one file and REOPENS in the other
 *
 * ── WHY THE SYMBOL, AND NOT A NAME OR AN OWNER ──────────────────────────────
 * Joining on (owner, name) is the tempting shortcut and it is the thing this scorer is
 * careful never to do: any unrelated `SetConstructor` or `addSelect` would satisfy it,
 * which manufactures the agreement the verdict is supposed to be measuring.
 *
 * `checker.getSymbolAtLocation` returns the MERGED symbol, and its declarations are
 * exactly the set the language considers one entity — every overload, across every file
 * an interface is reopened in. That is the same route #242 used to fix the dispatch
 * envelope for these very declarations, and the same shape as #308's contextual-type
 * emitter beside this file.
 *
 * A symbol with ONE declaration is not emitted: it has no sibling, so a row for it could
 * only ever match itself, which `otarget in eng` already covers.
 *
 * Output TSV, one row per declaration, ABSOLUTE paths so both sides resolve the same way
 * `score.py` resolves everything else. `group` is an opaque id, stable within a run:
 *   file line col group
 *
 * Usage: node overload-siblings.mjs <project-dir> <out.tsv>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadTypeScript } from './load-typescript.mjs';

const projectDir = path.resolve(process.argv[2] ?? '.');
const outPath = path.resolve(process.argv[3] ?? 'overload-siblings.tsv');

// Loaded from the project under analysis, so the answers come from the version the
// project is written against; see load-typescript.mjs (#239).
const ts = loadTypeScript(projectDir, { toolName: 'overload-siblings' });

function findAnyConfig(dir) {
  const up = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json');
  if (up && !path.relative(dir, up).startsWith('..')) return up;
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);
  const walk = (d, depth) => {
    if (depth > 4) return null;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return null; }
    if (entries.some((e) => e.isFile() && e.name === 'tsconfig.json')) return path.join(d, 'tsconfig.json');
    for (const e of entries) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) {
        const hit = walk(path.join(d, e.name), depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(dir, 0);
}

const configPath = findAnyConfig(projectDir);
if (!configPath) {
  console.error(`overload-siblings: no tsconfig.json under ${projectDir}`);
  process.exit(2);
}
const parsed = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, path.dirname(configPath)
);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

function posOf(node) {
  const sf = node.getSourceFile();
  const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return [realpath(sf.fileName), lc.line + 1, lc.character + 1];
}

// Every declaration form that can be one of several overloads of one callable.
const isCallLike = (n) => ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)
  || ts.isMethodSignature(n) || ts.isCallSignatureDeclaration(n)
  || ts.isConstructSignatureDeclaration(n) || ts.isConstructorDeclaration(n);

// The name node is where a symbol is attached; a construct or call signature has none,
// so the symbol is taken off the declaration itself.
const symbolOf = (n) => {
  try {
    return (n.name && checker.getSymbolAtLocation(n.name)) || checker.getSymbolAtLocation(n) || n.symbol;
  } catch { return undefined; }
};

const groups = new Map();   // symbol (or symbol+kind) -> group id
const rows = [];
const seen = new Set();
let declarations = 0;
let grouped = 0;

// A `new` or a bare call signature has NO NAME NODE, so getSymbolAtLocation returns
// nothing for it and the named path above cannot see it — which is the shape #310 is
// about. For those the merged entity is the INTERFACE: its symbol spans every file the
// interface is reopened in, and the signatures come off its declared type. Both
// `SetConstructor` declarations therefore land in one group, which is the point.
const addToGroup = (key, node) => {
  let g = groups.get(key);
  if (g === undefined) {
    g = `g${groups.size}`;
    groups.set(key, g);
  }
  const [f, l, c] = posOf(node);
  const row = `${f}\t${l}\t${c}\t${g}`;
  if (seen.has(row)) return false;
  seen.add(row);
  rows.push(row);
  return true;
};

for (const sf of program.getSourceFiles()) {
  const visitIface = (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name) {
      const sym = checker.getSymbolAtLocation(node.name);
      if (sym) {
        let declared;
        try { declared = checker.getDeclaredTypeOfSymbol(sym); } catch { /* unanswerable */ }
        for (const [kind, sigs] of [
          ['new', declared?.getConstructSignatures?.() ?? []],
          ['call', declared?.getCallSignatures?.() ?? []],
        ]) {
          const decls = sigs.map((x) => x.declaration).filter(Boolean);
          if (decls.length < 2) continue;
          for (const d of decls) { if (addToGroup(`${kind}:${checker.getFullyQualifiedName(sym)}:${sym.flags}`, d)) grouped += 1; }
        }
      }
    }
    ts.forEachChild(node, visitIface);
  };
  ts.forEachChild(sf, visitIface);
}

for (const sf of program.getSourceFiles()) {
  const visit = (node) => {
    if (isCallLike(node)) {
      declarations += 1;
      const sym = symbolOf(node);
      const decls = sym?.getDeclarations?.() ?? sym?.declarations ?? [];
      // Only the callable declarations count as siblings. A symbol may also carry a
      // property or a namespace declaration, and those are not overloads of it.
      const sibs = decls.filter(isCallLike);
      if (sibs.length > 1) {
        let g = groups.get(sym);
        if (g === undefined) {
          g = `g${groups.size}`;
          groups.set(sym, g);
        }
        const [f, l, c] = posOf(node);
        const key = `${f}\t${l}\t${c}\t${g}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push(key);
          grouped += 1;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

fs.writeFileSync(
  outPath,
  ['file', 'line', 'col', 'group'].join('\t') + '\n' + rows.join('\n') + (rows.length ? '\n' : '')
);
console.error(
  `overload-siblings: ${declarations} call-like declarations, ${grouped} in a group, `
  + `${groups.size} groups -> ${outPath}`
);
