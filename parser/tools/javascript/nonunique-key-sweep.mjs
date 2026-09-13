/**
 * WHICH LINKS ARE POPULATED FROM A MAP KEYED ON A TUPLE THAT IS NOT UNIQUE?
 *
 *     node tools/javascript/nonunique-key-sweep.mjs <sweep-out-dir>
 *
 * Two defects in this front end have had that cause, and they presented
 * differently, which is why looking for the CAUSE beats waiting for the symptom:
 *
 *   js_parse_gap's PRIMARY KEY was (kind, module, line, column, detail). Two
 *   identical diagnostics collided and the row DOUBLED - section 2's "duplicate
 *   keys do not collide, they double".
 *   js_import.boundVariableLinkHash was keyed (module, localName). A later
 *   binding of the same name took the link and the earlier row went NULL.
 *
 * Same cause, opposite symptoms: one too many rows, one too few links. A PK
 * uniqueness gate catches the first and is blind to the second.
 *
 * ## The fingerprint, and why a population rate is not it
 *
 * Most partially-populated FKs are legitimately conditional - a variable has no
 * typeReferenceLinkHash unless it is annotated - so a low rate says nothing.
 * What a keying bug leaves behind is an ORDER BIAS: inside one owner, among rows
 * that share an identity tuple, the LAST one holds the link and the earlier ones
 * are null. Genuine conditionality has no reason to prefer the last row and comes
 * out near 50%.
 *
 * So for every partially-populated FK: group by (owner, identity), keep groups
 * containing both a set and an unset row, and measure what fraction of the unset
 * rows precede every set row. Near 100% is the fingerprint. Reported with the
 * group count, never asserted - a bias over nine rows is noise.
 */
import fs from 'fs';
import path from 'path';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: nonunique-key-sweep.mjs <sweep-out-dir>'); process.exit(1); }

const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);

/** Columns that plausibly identify a row WITHIN its owner, best first. */
const IDENTITY = ['localName', 'name', 'exportedName', 'specifier', 'calleeText', 'referencedName', 'text'];
// FORM columns are part of identity. A class field declared bare (`#store;`,
// CLASS_FIELD, no source expression) and assigned in the constructor
// (CONSTRUCTOR_THIS_ASSIGNMENT, with one) are two rows BY DESIGN, and a
// comment-borne import (edgeBearer COMMENT) has no source expression by
// construction. Grouped with their same-named twin they read as a 100% order
// bias on the holdout — a fingerprint with nothing behind it. Found 2026-09-13.
const FORM = ['declarationForm', 'edgeBearer', 'importForm'];

function read(p) {
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) { return null; }
  const t = fs.readFileSync(p, 'utf8');
  const nl = t.indexOf(NL);
  const h = t.slice(0, nl).split(TAB);
  return { h, idx: Object.fromEntries(h.map((n, i) => [n, i])),
    rows: t.slice(nl + 1).split(NL).filter(Boolean).map((l) => l.split(TAB)) };
}

const stat = new Map();

/**
 * THE DETECTOR, as one function, so the self-test can feed it rows it built.
 * Groups rows by (owner, identity); in every group holding both a set and an
 * unset FK, counts the unset rows that precede every set row.
 */
function scoreColumn(s, rows, omIdx, lineIdx, identIdx, fkIdx, describe, formIdx = []) {
  const groups = new Map();
  for (const r of rows) {
    const g = r[omIdx] + ' ' + r[identIdx] + ' ' + formIdx.map((i) => r[i]).join('|');
    (groups.get(g) ?? groups.set(g, []).get(g)).push(r);
  }
  for (const rs of groups.values()) {
    if (rs.length < 2) { continue; }
    const setRows = rs.filter((r) => r[fkIdx]);
    const unsetRows = rs.filter((r) => !r[fkIdx]);
    if (!setRows.length || !unsetRows.length) { continue; }
    s.groups++;
    const minSet = Math.min(...setRows.map((r) => Number(r[lineIdx])));
    for (const u of unsetRows) {
      s.unset++;
      if (Number(u[lineIdx]) < minSet) {
        s.before++;
        if (s.ex.length < 3 && describe) { s.ex.push(describe(u) + ' unset; set at ' + setRows.map((r) => r[lineIdx]).join(',')); }
      }
    }
  }
}
const get = (k) => stat.get(k) ?? stat.set(k, { groups: 0, unset: 0, before: 0, ex: [] }).get(k);

for (const d of fs.readdirSync(OUT).sort()) {
  const dd = path.join(OUT, d);
  if (!fs.statSync(dd).isDirectory()) { continue; }
  const mods = read(path.join(dd, 'all-javascript-modules.csv'));
  if (!mods) { continue; }
  const project = new Set(); const file = new Map();
  for (const r of mods.rows) {
    file.set(r[mods.idx.jsModuleUniqueHash], r[mods.idx.filePath]);
    if (r[mods.idx.sourceProvenance] === 'PROJECT') { project.add(r[mods.idx.jsModuleUniqueHash]); }
  }
  for (const f of fs.readdirSync(dd)) {
    if (!f.startsWith('all-javascript-') || !f.endsWith('.csv')) { continue; }
    const rel = f.slice('all-javascript-'.length, -4);
    if (rel === 'modules') { continue; }
    const t = read(path.join(dd, f));
    if (!t) { continue; }
    const om = t.idx.ownerModuleLinkHash;
    const line = t.idx.startLine;
    if (om === undefined || line === undefined) { continue; }
    const ident = IDENTITY.find((c) => t.idx[c] !== undefined);
    if (ident === undefined) { continue; }
    const fks = t.h.filter((n) => n.endsWith('LinkHash')
      && !n.startsWith('serviceVersion') && !n.startsWith('owner'));
    for (const col of fks) {
      const i = t.idx[col];
      let nset = 0; let nunset = 0;
      for (const r of t.rows) {
        if (r.length < t.h.length || !project.has(r[om])) { continue; }
        if (r[i]) { nset++; } else { nunset++; }
      }
      if (nset === 0 || nunset === 0) { continue; }
      const key = rel + '.' + col;
      scoreColumn(get(key), t.rows.filter((r) => r.length >= t.h.length && project.has(r[om])),
        om, line, t.idx[ident], i, (r) => file.get(r[om]) + ':' + r[line] + ' ' + ident + '='
          + String(r[t.idx[ident]] || '').slice(0, 24),
        FORM.map((c) => t.idx[c]).filter((x) => x !== undefined));
    }
  }
}

// ---- SELF-TEST BY INJECTION, through the detector itself ---------------------
// The first version required imports.boundVariableLinkHash to score ~100%,
// because that was the live defect this sweep was built from. js-impl fixed it
// and the self-test failed - correctly, and uselessly, because the sweep became
// unrunnable the moment it had done its job. A control that depends on a live
// bug expires with the bug. So the control is INJECTED: rows are built with the
// last-wins shape and fed through scoreColumn, the same function every real
// column goes through. Columns: [owner, line, name, fk].
{
  const inj = [];
  for (let g = 0; g < 50; g++) {
    for (let r = 0; r < 3; r++) { inj.push(['M', String(10 + r), 'name' + g, '']); }   // three earlier, null
    inj.push(['M', '99', 'name' + g, 'HASH']);                                         // last, set
  }
  const ctl = [];
  for (let g = 0; g < 50; g++) {                                                       // conditionality: no order bias
    ctl.push(['M', '10', 'c' + g, 'HASH']); ctl.push(['M', '20', 'c' + g, '']);
    ctl.push(['M', '30', 'c' + g, 'HASH']); ctl.push(['M', '40', 'c' + g, '']);
  }
  const a = { groups: 0, unset: 0, before: 0, ex: [] }; scoreColumn(a, inj, 0, 1, 2, 3);
  const b = { groups: 0, unset: 0, before: 0, ex: [] }; scoreColumn(b, ctl, 0, 1, 2, 3);
  const pa = 100 * a.before / a.unset; const pb = 100 * b.before / b.unset;
  console.log('SELF-TEST through scoreColumn: injected last-wins ' + pa.toFixed(1) + '% (need >=90), '
    + 'injected conditionality ' + pb.toFixed(1) + '% (need <90)');
  if (!(pa >= 90 && pb < 90)) { console.log('  self-test FAILED - the detector cannot tell the fingerprint from conditionality'); process.exit(1); }
  console.log('  self-test PASS');
}
const known = stat.get('imports.boundVariableLinkHash');
if (known && known.unset > 0) {
  console.log('  note: imports.boundVariableLinkHash, the defect this sweep was built from, now scores '
    + (100 * known.before / known.unset).toFixed(1) + '% over ' + known.unset + ' unset - fixed if near 0%.');
}
console.log('');
console.log('ORDER BIAS by FK column (at least 20 unset rows in mixed groups), highest first:');
console.log('  ' + 'relation.column'.padEnd(48) + 'groups'.padStart(8) + 'unset'.padStart(8)
  + 'earlier'.padStart(9) + 'bias'.padStart(8));
const ranked = [...stat].filter((e) => e[1].unset >= 20)
  .sort((a, b) => (b[1].before / b[1].unset) - (a[1].before / a[1].unset));
for (const [k, s] of ranked) {
  const bias = 100 * s.before / s.unset;
  console.log('  ' + k.padEnd(48) + String(s.groups).padStart(8) + String(s.unset).padStart(8)
    + String(s.before).padStart(9) + bias.toFixed(1).padStart(7) + '%'
    + (bias >= 90 ? '   <-- FINGERPRINT' : ''));
  if (bias >= 90) { for (const e of s.ex) { console.log('        e.g. ' + e); } }
}
