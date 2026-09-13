/**
 * Regenerate `src/test-data/javascript/categories/COVERAGE.md` from a parser run.
 *
 *     node tools/javascript/coverage-ledger.mjs <parser-output-dir> [--check]
 *
 * ## This is a derived file and hand-editing it is the failure mode
 *
 * Every number below comes from extracting `categories/` and reading the fact
 * base. Nothing here is an expectation: the ledger says what the corpus REACHES,
 * not what any row should contain. Coverage gates whether the correctness gates
 * are entitled to run; it is not itself a correctness measure.
 *
 * ## The SOLE COVER column is the prune guard, computed rather than judged
 *
 * A fixture that is the only file in the tree emitting some declared enum value
 * may not be deleted, however redundant it looks beside its neighbours. Eyeballing
 * that is exactly how the last cover for a node kind gets pruned, so it is
 * computed: for every declared value, which files emit it, and which values have
 * exactly one emitter.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const OUT = process.argv[2];
const CHECK = process.argv.includes('--check');
const ROOT = path.resolve(path.join(import.meta.dirname, '..', '..'));
const TARGET = path.join(ROOT, 'src/test-data/javascript/categories/COVERAGE.md');

/**
 * The enum vocabularies, read from the parser's own source of truth.
 *
 * A regex over `export enum X { ... }` was the first version and it under-counted
 * 264 against the 327 an `import * as JsEnums` sees: several files declare more
 * than one enum, and a `}` inside a doc comment ends a non-greedy body match
 * early. Both failures are silent and both shrink the denominator, which makes
 * the ledger read MORE complete than it is. Brace-matched, multi-enum, and
 * cross-checked against a declared floor below.
 */
const enumsDir = path.join(ROOT, 'src/enums/javascript');
const declared = new Map();   // value -> enum name
function loadEnums(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { loadEnums(p); continue; }
    if (!e.name.endsWith('.ts')) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/export enum (\w+)\s*\{/g)) {
      const name = m[1];
      let i = src.indexOf('{', m.index), depth = 0, end = i;
      for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}') { depth--; if (depth === 0) break; }
      }
      for (const v of src.slice(i, end).matchAll(/^\s*([A-Z0-9_]+)\s*=\s*'([^']+)'/gm)) declared.set(v[2], name);
    }
  }
}
loadEnums(enumsDir);
// A floor, so the loader silently reading fewer files than it should is a failure
// rather than a smaller denominator. Raise it when the schema grows.
//
// 264 is DISTINCT STRING VALUES, not declarations. There are 327 (enum, value)
// pairs and 35 values declared in more than one enum — `NONE` in ten of them.
// That gap is not bookkeeping: it is why a whole-cell audit marks an enum covered
// on another enum's evidence, and why the gate below is scoped per column.
const DECLARED_FLOOR = 260;
if (declared.size < DECLARED_FLOOR) {
  console.error(`only ${declared.size} enum values parsed, floor is ${DECLARED_FLOOR} — the loader is `
    + 'missing files or enums, and every coverage figure below it would read too high');
  process.exit(1);
}

/**
 * CSV file stem -> relation name. The file names are plural and the relations are
 * singular, and a ledger that prints `js_blocks` is naming a relation that does
 * not exist. Explicit, with a guard, rather than a de-pluralising regex.
 */
const RELATION = {
  modules: 'js_module', scopes: 'js_scope', types: 'js_type', 'type-heritages': 'js_type_heritage',
  methods: 'js_method', 'method-parameters': 'js_method_parameter', fields: 'js_field',
  variables: 'js_variable', blocks: 'js_block', expressions: 'js_expression',
  'call-sites': 'js_call_site', imports: 'js_import', exports: 'js_export',
  comments: 'js_comment', 'type-references': 'js_type_reference', 'parse-gaps': 'js_parse_gap',
};

function readCsv(p) {
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) return null;
  const t = fs.readFileSync(p, 'utf8'); const nl = t.indexOf('\n');
  return { h: t.slice(0, nl).split('\t'), rows: t.slice(nl + 1).split('\n').filter(Boolean).map((l) => l.split('\t')) };
}
const mods = readCsv(path.join(OUT, 'all-javascript-modules.csv'));
const hashFile = new Map();
for (const r of mods.rows) hashFile.set(r[mods.h.indexOf('jsModuleUniqueHash')], r[mods.h.indexOf('filePath')]);

const relCounts = {};
const emitters = new Map();          // value -> Set(file)
for (const f of fs.readdirSync(OUT).sort()) {
  if (!f.startsWith('all-javascript-') || !f.endsWith('.csv')) continue;
  const rel = f.replace('all-javascript-', '').replace('.csv', '');
  const csv = readCsv(path.join(OUT, f));
  if (!RELATION[rel]) { console.error(`no relation name for CSV stem '${rel}' — a new relation `
    + 'landed and this ledger would have printed a name that does not exist'); process.exit(1); }
  relCounts[rel] = csv ? csv.rows.length : 0;
  if (!csv) continue;
  const iM = csv.h.indexOf('ownerModuleLinkHash') >= 0 ? csv.h.indexOf('ownerModuleLinkHash') : csv.h.indexOf('jsModuleUniqueHash');
  for (const r of csv.rows) {
    const file = iM >= 0 ? hashFile.get(r[iM]) : undefined;
    for (const c of r) if (declared.has(c)) {
      const s = emitters.get(c) ?? emitters.set(c, new Set()).get(c);
      if (file) s.add(file);
    }
  }
}

const covered = [...emitters.keys()].sort();
const uncovered = [...declared.keys()].filter((v) => !emitters.has(v)).sort();
const sole = covered.filter((v) => emitters.get(v).size === 1);
const soleByFile = new Map();
for (const v of sole) {
  const f = [...emitters.get(v)][0];
  (soleByFile.get(f) ?? soleByFile.set(f, []).get(f)).push(v);
}

const ms = {}, msSrc = {}, contra = {};
for (const r of mods.rows) {
  const g = (n) => r[mods.h.indexOf(n)];
  ms[g('moduleSystem')] = (ms[g('moduleSystem')] || 0) + 1;
  msSrc[g('moduleSystemSource')] = (msSrc[g('moduleSystemSource')] || 0) + 1;
  contra[g('contradictionKind')] = (contra[g('contradictionKind')] || 0) + 1;
}
const tbl = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| \`${k}\` | ${v} |`).join('\n');

const body = `# categories/ — what this corpus REACHES

<!-- GENERATED by tools/javascript/coverage-ledger.mjs. Do not hand-edit.
     Regenerate after any move:  node tools/javascript/coverage-ledger.mjs <out-dir>
     Verify in CI:               node tools/javascript/coverage-ledger.mjs <out-dir> --check -->

**Source only. No expected facts.** Nothing in \`categories/\` states what the parser
should emit, and nothing in this file does either. This is a property of the
CORPUS, never of the parser: it gates whether the correctness gates are entitled
to run, and it is not itself a correctness measure.

Promotion from \`staging/\` is a pure function — see \`tools/javascript/promote-fixtures.mjs\`
and \`PROVENANCE.json\`. \`staging/\` remains \`js-fixtures\`' directory; this tree is
re-derived from it rather than forked.

## Files and rows

${mods.rows.length} modules, ${Object.values(relCounts).reduce((a, b) => a + b, 0)} rows, all ${Object.keys(relCounts).length} relations present.

| relation | rows |
|---|---|
${Object.entries(relCounts).sort().map(([k, v]) => `| \`${RELATION[k]}\` | ${v} |`).join('\n')}

## Module-system governance

The reason the category layout carries nested \`package.json\` files: a fixture's
meaning depends on its nearest ancestor's \`"type"\`, so flattening the tree would
have converted every ESM fixture into a contradiction and destroyed what it tests.

| \`moduleSystem\` | files |
|---|---|
${tbl(ms)}

| \`moduleSystemSource\` | files |
|---|---|
${tbl(msSrc)}

| \`contradictionKind\` | files |
|---|---|
${tbl(contra)}

## Declared enum values reached

**${covered.length} of ${declared.size} declared values are emitted by this tree.**
The ${uncovered.length} not reached are listed below; an unreached value is a
statement about this corpus, and is only a defect once someone has checked which
of the three §4 outcomes it is.

### Not reached by \`categories/\`

${uncovered.length === 0 ? '_none_' : uncovered.map((v) => `- \`${declared.get(v)}.${v}\``).join('\n')}

## THE PRUNE GUARD — ${sole.length} values have exactly one cover

**No file below may be deleted.** Each is the only file in this tree that emits
the values listed beside it, so removing it removes the last evidence that the
value is reachable at all — and an unreachable value cannot be told apart from an
unimplemented one.

| fixture | values it alone covers |
|---|---|
${[...soleByFile].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  .map(([f, vs]) => `| \`${f}\` | ${vs.sort().map((v) => `\`${v}\``).join(', ')} |`).join('\n')}

### Fixtures covering no value alone (${[...new Set([...emitters.values()].flatMap((s) => [...s]))].filter((f) => !soleByFile.has(f)).length})

These are **not** therefore prunable. They carry positions, nesting and
combinations that a single-value coverage map cannot see — two on one line, a
construct nested inside one that emits nothing, an operator variant in a column.
Coverage of enum VALUES is a lower bound on what a fixture is for.

${[...new Set([...emitters.values()].flatMap((s) => [...s]))].filter((f) => !soleByFile.has(f)).sort().map((f) => `- \`${f}\``).join('\n')}
`;

if (CHECK) {
  const have = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (have === body) { console.log('COVERAGE.md is in sync'); process.exit(0); }
  console.log('COVERAGE.md is STALE — regenerate it, do not hand-edit it');
  process.exit(1);
}
fs.writeFileSync(TARGET, body);
console.log(`wrote COVERAGE.md: ${mods.rows.length} modules, ${covered.length}/${declared.size} values covered, `
  + `${sole.length} single-cover values across ${soleByFile.size} unprunable fixtures`);
