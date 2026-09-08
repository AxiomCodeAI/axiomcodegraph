#!/usr/bin/env node
/**
 * WHICH SIGNATURE DOES THIS BODY IMPLEMENT — asked of the compiler, answered by position.
 *
 * ── THE VERDICT THIS EXISTS TO CORRECT ──────────────────────────────────────
 * `const setState: Api<S>['setState'] = (...a) => { ... }` is, to the compiler, the
 * call signature declared inside a type literal in another file; to the engine it is
 * the arrow. When a call through that name is scored, the oracle names the SIGNATURE
 * and the engine names the ARROW, and `score.py` had no way to see that these are the
 * same callable:
 *
 *     oracle  vanilla.ts:2:3     TYPE_LITERAL_METHOD_SIGNATURE
 *     engine  devtools.ts:258:59 ARROW_FUNCTION  <arrow>
 *
 * so the site scored WRONG. Measured on a dev corpus member: 9 of its 9 WRONG rows are
 * this shape, on the project with the lowest exactness in the set. See issue #237.
 *
 * The credit already in `score.py` cannot reach it, and for two independent reasons:
 * the declarations are in DIFFERENT FILES, and the arrow is ANONYMOUS so no name is
 * shared. Both of its gates fail on the same rows.
 *
 * ── WHY THE CONTEXTUAL TYPE, AND NOT ASSIGNABILITY ──────────────────────────
 * The tempting question is "is the body's type assignable to the signature's type",
 * and it is the wrong one: `(...a: any[]) => void` is assignable to a great many
 * signatures, so that rule would credit unrelated functions and manufacture the
 * agreement it is supposed to be measuring — which is the failure `score.py`'s own
 * comment warns about for name matching.
 *
 * The right question is narrower: what type does the declaration ITSELF say the body
 * has. `checker.getContextualType(fn)` answers that from the annotation, the parameter
 * position, or the `satisfies` — and returns nothing for an unannotated function, so
 * an arrow that merely happens to be compatible is credited to nothing. Measured:
 *
 *     const f: Api<S>['setState'] = (...a) => {}   ctx -> vanilla.ts:2:3  vanilla.ts:3:3
 *     const g = (...a: any[]) => {}                ctx -> (none)
 *
 * Note the first resolves an INDEXED-ACCESS type across a file boundary, which is the
 * idiom the corpus actually uses to express an overloaded function type, and which no
 * join over the IR's own type-reference links can follow.
 *
 * An overload set yields every one of its signature declarations, which is correct:
 * the body implements all of them, and the oracle may name any.
 *
 * ── WHAT THIS DOES NOT COVER, DELIBERATELY ──────────────────────────────────
 * A class or object-literal member implementing an interface member is a different
 * route — the owner type is assignable to the interface, and the member is looked up
 * on it. `score.py` already credits that when the two are in the same file, and that
 * credit fires ZERO times on every dev corpus member as measured, so widening it is
 * not justified by anything observable yet. It wants its own issue and its own
 * before/after rather than being folded in here on the strength of a synthetic.
 *
 * Output TSV, one row per (body, signature) pair, ABSOLUTE paths so both sides of the
 * comparison resolve the same way `score.py` resolves everything else:
 *   implFile implLine implCol sigFile sigLine sigCol
 *
 * Usage: node signature-impls.mjs <project-dir> <out.tsv>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadTypeScript } from './load-typescript.mjs';

const projectDir = path.resolve(process.argv[2] ?? '.');
const outPath = path.resolve(process.argv[3] ?? 'signature-impls.tsv');

// Loaded from the project under analysis, so the answers come from the version the
// project is written against; see load-typescript.mjs (#239).
const ts = loadTypeScript(projectDir, { toolName: 'signature-impls' });

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
  console.error(`signature-impls: no tsconfig.json under ${projectDir}`);
  process.exit(2);
}
const parsed = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, path.dirname(configPath)
);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

function posOf(node) {
  const sf = node.getSourceFile();
  const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  let real = sf.fileName;
  try { real = fs.realpathSync(sf.fileName); } catch { /* keep */ }
  return [real, lc.line + 1, lc.character + 1];
}

const rows = [];
const seen = new Set();
let bodies = 0;
let contextual = 0;

for (const sf of program.getSourceFiles()) {
  // Bodies live in real source; a declaration file has none to attribute.
  if (sf.isDeclarationFile) continue;
  const visit = (node) => {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)
        || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) {
      bodies += 1;
      let ctx;
      try { ctx = checker.getContextualType(node); } catch { /* unanswerable */ }
      const sigs = ctx?.getCallSignatures?.() ?? [];
      if (sigs.length) contextual += 1;
      const [ifile, iline, icol] = posOf(node);
      for (const sig of sigs) {
        const d = sig.declaration;
        if (!d) continue;
        // A body is not its own signature. `function f() {}` is contextually typed by
        // itself in some positions, and crediting that would make every function
        // trivially implement itself.
        if (d === node) continue;
        const [sfile, sline, scol] = posOf(d);
        const key = `${ifile}\t${iline}\t${icol}\t${sfile}\t${sline}\t${scol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(key);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

fs.writeFileSync(
  outPath,
  ['implFile', 'implLine', 'implCol', 'sigFile', 'sigLine', 'sigCol'].join('\t')
    + '\n' + rows.join('\n') + (rows.length ? '\n' : '')
);
console.error(
  `signature-impls: ${bodies} bodies, ${contextual} contextually typed, `
  + `${rows.length} (body, signature) pairs -> ${outPath}`
);
