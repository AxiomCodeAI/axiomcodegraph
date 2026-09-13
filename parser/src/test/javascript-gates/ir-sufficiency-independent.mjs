/**
 * DOES THE IR CARRY THE EDGES AN ENGINE NEEDS? — built independently.
 *
 *     node src/test/javascript-gates/ir-sufficiency-independent.mjs <sweep-out-dir>
 *
 * js-impl has its own `javascript-gates/ir-sufficiency.ts`. This is deliberately NOT
 * that: it shares no code, no column list and no traversal with it, and it was
 * written from the SCHEMA rather than from their measure. Two measures agreeing
 * because they share code means nothing; two built separately agreeing is
 * evidence. Where they disagree, the disagreement is the finding.
 *
 * Recall asks "is there a row". This asks "can the engine get from one row to the
 * next", which is a different question and the one §0 of BUILDING-A-PARSER.md
 * says the parser is actually for: the engine resolves, so the parser's job is
 * to leave every hop present.
 *
 * Five hops, each phrased as a join the engine would have to perform:
 *   METHOD CALL      call site -> the expression that is its callee
 *   MEMBER FLOW      a member access -> the member NAME it reads
 *   FIELD FLOW       a field write -> the field name and its owner type
 *   MODULE ALIASING  an import binding -> the variable it binds
 *   TYPE FLOW        a declared type name -> a js_type_reference row
 *
 * A hop that cannot be taken is reported with the reason, never as a bare rate.
 */
import fs from 'fs';
import path from 'path';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: ir-sufficiency-independent.mjs <sweep-out-dir>'); process.exit(1); }

function read(p) {
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) return null;
  const t = fs.readFileSync(p, 'utf8'); const nl = t.indexOf('\n');
  const h = t.slice(0, nl).split('\t');
  const idx = Object.fromEntries(h.map((n, i) => [n, i]));
  return { h, idx, rows: t.slice(nl + 1).split('\n').filter(Boolean).map(l => l.split('\t')) };
}

const tally = {};
const bump = (k, n = 1) => { tally[k] = (tally[k] || 0) + n; };
const examples = {};
const ex = (k, s) => { (examples[k] ??= []).length < 3 && examples[k].push(s); };

let packages = 0;
for (const d of fs.readdirSync(OUT).sort()) {
  const dd = path.join(OUT, d);
  if (!fs.statSync(dd).isDirectory()) continue;
  const mods = read(path.join(dd, 'all-javascript-modules.csv'));
  if (!mods) continue;
  packages++;
  const project = new Set();
  for (const r of mods.rows) {
    if (r[mods.idx.sourceProvenance] === 'PROJECT') project.add(r[mods.idx.jsModuleUniqueHash]);
  }
  const file = new Map(mods.rows.map(r => [r[mods.idx.jsModuleUniqueHash], r[mods.idx.filePath]]));

  const expr = read(path.join(dd, 'all-javascript-expressions.csv'));
  const cs   = read(path.join(dd, 'all-javascript-call-sites.csv'));
  const fld  = read(path.join(dd, 'all-javascript-fields.csv'));
  const imp  = read(path.join(dd, 'all-javascript-imports.csv'));
  const vr   = read(path.join(dd, 'all-javascript-variables.csv'));
  const tref = read(path.join(dd, 'all-javascript-type-references.csv'));
  const mp   = read(path.join(dd, 'all-javascript-method-parameters.csv'));
  const ty   = read(path.join(dd, 'all-javascript-types.csv'));

  const exprById = new Map();
  if (expr) for (const r of expr.rows) exprById.set(r[expr.idx.jsExpressionUniqueHash], r);
  const typeIds = new Set(ty ? ty.rows.map(r => r[ty.idx.jsTypeUniqueHash]) : []);
  const varIds  = new Set(vr ? vr.rows.map(r => r[vr.idx.jsVariableUniqueHash]) : []);
  const paramIds = new Set(mp ? mp.rows.map(r => r[mp.idx.jsMethodParameterUniqueHash]) : []);
  const trefIds = new Set(tref ? tref.rows.map(r => r[tref.idx.jsTypeReferenceUniqueHash]) : []);

  // ---- HOP 1: METHOD CALL — call site -> its callee expression ------------
  if (cs && expr) for (const r of cs.rows) {
    if (!project.has(r[cs.idx.ownerModuleLinkHash])) continue;
    bump('methodCall.total');
    const e = r[cs.idx.expressionLinkHash];
    if (e && exprById.has(e)) bump('methodCall.ok');
    else { bump('methodCall.MISSING_CALLEE_EXPRESSION'); ex('methodCall.MISSING_CALLEE_EXPRESSION',
      `${file.get(r[cs.idx.ownerModuleLinkHash])}:${r[cs.idx.startLine]} ${r[cs.idx.calleeText].slice(0,40)}`); }
  }

  // ---- HOP 2: MEMBER FLOW — a member access carries the member NAME -------
  if (expr) for (const r of expr.rows) {
    if (!project.has(r[expr.idx.ownerModuleLinkHash])) continue;
    // THE VALUES ARE `PROPERTY_ACCESS` and `ELEMENT_ACCESS`. My first draft asked
    // for `MEMBER_ACCESS`, which this schema does not have, so the hop reported
    // 0/0 and printed "n/a" — structurally incapable of returning anything else.
    // That is the same failure js-impl's own first draft had (asking
    // `referencedName` where it needed `name`), and the reason the DENOMINATOR
    // GUARD below exists: a hop whose denominator is zero is a broken measure,
    // not a clean result.
    const kind = r[expr.idx.expressionKind];
    if (kind !== 'PROPERTY_ACCESS' && kind !== 'ELEMENT_ACCESS') continue;
    bump('memberFlow.total');
    const computed = kind === 'ELEMENT_ACCESS' || r[expr.idx.isComputedName] === 'true';
    if (r[expr.idx.name]) bump('memberFlow.ok');
    else if (computed) bump('memberFlow.COMPUTED_UNDECIDABLE');  // honest terminal, not a gap
    else { bump('memberFlow.MISSING_NAME'); ex('memberFlow.MISSING_NAME',
      `${file.get(r[expr.idx.ownerModuleLinkHash])}:${r[expr.idx.startLine]} ${r[expr.idx.text].slice(0,40)}`); }
  }

  // ---- HOP 3: FIELD FLOW — a field row names its member and its owner -----
  if (fld) for (const r of fld.rows) {
    if (!project.has(r[fld.idx.ownerModuleLinkHash])) continue;
    bump('fieldFlow.total');
    const named = !!r[fld.idx.name];
    const owner = r[fld.idx.ownerTypeLinkHash];
    if (named && owner && typeIds.has(owner)) bump('fieldFlow.ok');
    else if (!named) bump('fieldFlow.MISSING_NAME');
    else if (!owner) bump('fieldFlow.NO_OWNER_TYPE');
    else { bump('fieldFlow.OWNER_DANGLING'); ex('fieldFlow.OWNER_DANGLING',
      `${file.get(r[fld.idx.ownerModuleLinkHash])} ${r[fld.idx.name]}`); }
  }

  // ---- HOP 4: MODULE ALIASING — an import binds a reachable local ---------
  if (imp) for (const r of imp.rows) {
    if (!project.has(r[imp.idx.ownerModuleLinkHash])) continue;
    if (!r[imp.idx.localName]) continue;              // side-effect import binds nothing
    bump('moduleAlias.total');
    const b = r[imp.idx.boundVariableLinkHash];
    if (b && varIds.has(b)) bump('moduleAlias.ok');
    else if (!b) { bump('moduleAlias.NO_BOUND_VARIABLE'); ex('moduleAlias.NO_BOUND_VARIABLE',
      `${file.get(r[imp.idx.ownerModuleLinkHash])}:${r[imp.idx.startLine]} ${r[imp.idx.specifier]} as ${r[imp.idx.localName]}`); }
    else { bump('moduleAlias.BOUND_DANGLING'); }
  }

  // ---- HOP 5: TYPE FLOW — a declared type name reaches a reference row ----
  for (const [rel, tbl] of [['param', mp], ['variable', vr], ['field', fld]]) {
    if (!tbl) continue;
    for (const r of tbl.rows) {
      if (!project.has(r[tbl.idx.ownerModuleLinkHash])) continue;
      if (!r[tbl.idx.declaredTypeName]) continue;
      bump('typeFlow.total');
      const t = r[tbl.idx.typeReferenceLinkHash];
      if (t && trefIds.has(t)) bump('typeFlow.ok');
      else { bump(`typeFlow.NO_REFERENCE_ROW__${rel}`); ex(`typeFlow.NO_REFERENCE_ROW__${rel}`,
        `${file.get(r[tbl.idx.ownerModuleLinkHash])} ${r[tbl.idx.name]}: ${r[tbl.idx.declaredTypeName].slice(0,30)}`); }
    }
  }

  // ---- THE PARAMETER HOP, measured because it is ruled and queued ---------
  if (expr) for (const r of expr.rows) {
    if (!project.has(r[expr.idx.ownerModuleLinkHash])) continue;
    const res = r[expr.idx.bindingResolution];
    if (res !== 'LOCAL' && res !== 'CLOSURE') continue;
    bump('paramHop.resolvedRefs');
    const b = r[expr.idx.resolvedBindingLinkHash];
    if (b && varIds.has(b)) bump('paramHop.reachesVariable');
    else if (b && paramIds.has(b)) bump('paramHop.reachesParameter_UNEXPECTED');
    else bump(`paramHop.UNLINKED__${res}`);
  }
  if (mp) for (const r of mp.rows) {
    if (project.has(r[mp.idx.ownerModuleLinkHash])) bump('paramHop.parameterRows');
  }
}

const pct = (ok, tot) => tot ? (100 * ok / tot).toFixed(1) + '%' : 'n/a';
// DENOMINATOR GUARD. A hop with no denominator has not been measured, and printing
// "n/a" beside four real percentages invites it being read as "fine". Fail instead.
const EMPTY = ['methodCall.total','memberFlow.total','fieldFlow.total','moduleAlias.total','typeFlow.total']
  .filter((k) => !(tally[k] > 0));
if (EMPTY.length) {
  console.error(`these hops have a ZERO denominator and were therefore not measured: ${EMPTY.join(', ')}`);
  console.error('a column name or enum value is wrong; this is a broken measure, not a clean result');
  process.exit(1);
}
console.log(`packages: ${packages}\n`);
console.log('IR SUFFICIENCY — can the engine take the hop? (PROJECT files only)');
for (const [name, tot, ok] of [
  ['method call  -> callee expression', 'methodCall.total', 'methodCall.ok'],
  ['member flow  -> member name',       'memberFlow.total', 'memberFlow.ok'],
  ['field flow   -> name + owner type', 'fieldFlow.total',  'fieldFlow.ok'],
  ['module alias -> bound variable',    'moduleAlias.total','moduleAlias.ok'],
  ['type flow    -> type reference',    'typeFlow.total',   'typeFlow.ok'],
]) {
  console.log(`  ${name.padEnd(36)} ${String(tally[ok] || 0).padStart(8)} / ${String(tally[tot] || 0).padStart(8)}  ${pct(tally[ok] || 0, tally[tot] || 0).padStart(6)}`);
}
console.log('\nwhere a hop could not be taken:');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  if (/\.(ok|total|resolvedRefs|reachesVariable|parameterRows)$/.test(k)) continue;
  console.log(`  ${String(v).padStart(8)}  ${k}`);
  for (const e of examples[k] ?? []) console.log(`             e.g. ${e}`);
}
console.log('\nTHE PARAMETER HOP (ruled and queued by js-oracle; measured here only to reconcile):');
console.log(`  resolved LOCAL/CLOSURE references : ${tally['paramHop.resolvedRefs'] || 0}`);
console.log(`    reaching a js_variable          : ${tally['paramHop.reachesVariable'] || 0}`);
console.log(`    UNLINKED (LOCAL)                : ${tally['paramHop.UNLINKED__LOCAL'] || 0}`);
console.log(`    UNLINKED (CLOSURE)              : ${tally['paramHop.UNLINKED__CLOSURE'] || 0}`);
console.log(`  js_method_parameter rows          : ${tally['paramHop.parameterRows'] || 0}`);
