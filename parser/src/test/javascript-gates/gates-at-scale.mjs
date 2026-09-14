/**
 * The day-one gates, run at corpus scale, each proven able to fail.
 * Relation list derived from the OUTPUT DIRECTORY, never a hand-maintained array.
 */
import fs from 'fs'; import path from 'path';
const ROOTS = process.argv.slice(2).filter(a => a !== '--negative');
const NEGATIVE = process.argv.includes('--negative');

function relations(dir) {
  return fs.readdirSync(dir).filter(f => f.startsWith('all-javascript-') && f.endsWith('.csv'));
}
function read(p) {
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) return null;
  const t = fs.readFileSync(p, 'utf8'); const nl = t.indexOf('\n');
  return { h: t.slice(0, nl).split('\t'), rows: t.slice(nl + 1).split('\n').filter(Boolean).map(l => l.split('\t')) };
}
const packs = [];
for (const root of ROOTS) for (const sub of fs.readdirSync(root)) {
  const d = path.join(root, sub);
  if (!fs.statSync(d).isDirectory()) continue;   // sweep.ts writes _summaries.json beside the packages
  if (relations(d).length) packs.push(d);
}
if (!packs.length) { console.log('no packages found'); process.exit(1); }

let fails = 0;
const fail = (m) => { console.log('  FAIL ' + m); fails++; };

// ---- 1. PK uniqueness -----------------------------------------------------
let pkRows = 0, pkDupes = 0; const dupeEx = [];
for (const d of packs) for (const f of relations(d)) {
  const c = read(path.join(d, f)); if (!c) continue;
  const pk = c.h.findIndex(x => /^js[A-Z]\w*UniqueHash$/.test(x));
  if (pk < 0) { fail(`${f} has no ...UniqueHash column — PK cannot be checked`); continue; }
  const seen = new Set();
  for (const r of c.rows) {
    pkRows++;
    if (seen.has(r[pk])) { pkDupes++; if (dupeEx.length < 5) dupeEx.push(`${path.basename(d)}/${f} ${r[pk]}`); }
    seen.add(r[pk]);
  }
}
console.log(`1. PK uniqueness      : ${pkRows} rows, ${pkDupes} duplicate key(s)`);
if (pkDupes) { fail(`duplicate primary keys: ${dupeEx.join(', ')}`); }

// ---- 2. FK integrity ------------------------------------------------------
let fkChecked = 0, fkDangling = 0; const fkEx = [];
for (const d of packs) {
  const keys = new Set();
  for (const f of relations(d)) {
    const c = read(path.join(d, f)); if (!c) continue;
    const pk = c.h.findIndex(x => /^js[A-Z]\w*UniqueHash$/.test(x));
    if (pk >= 0) for (const r of c.rows) keys.add(r[pk]);
  }
  for (const f of relations(d)) {
    const c = read(path.join(d, f)); if (!c) continue;
    const fks = c.h.map((x, i) => [x, i]).filter(([x]) => /LinkHash$/.test(x)
      && !/^serviceVersionLinkHash$/.test(x) && !/^resolvedModuleLinkHash$/.test(x)
      && !/^referencedTypeRegistryLinkHash$/.test(x));
    for (const r of c.rows) for (const [name, i] of fks) {
      const v = r[i]; if (!v) continue;
      fkChecked++;
      if (!keys.has(v)) { fkDangling++; if (fkEx.length < 5) fkEx.push(`${path.basename(d)}/${f}.${name}=${v.slice(0,12)}`); }
    }
  }
}
console.log(`2. FK integrity       : ${fkChecked} FK values, ${fkDangling} dangling`);
if (fkDangling) fail(`dangling FKs: ${fkEx.join(', ')}`);

// ---- 3. call site <-> expression 1:1 --------------------------------------
let csRows = 0, csNoExpr = 0, exprNoCs = 0;
for (const d of packs) {
  const cs = read(path.join(d, 'all-javascript-call-sites.csv'));
  const ex = read(path.join(d, 'all-javascript-expressions.csv'));
  if (!cs || !ex) continue;
  const exKeys = new Set(ex.rows.map(r => r[ex.h.indexOf('jsExpressionUniqueHash')]));
  const exCallSite = new Map();
  const iCs = ex.h.indexOf('callSiteLinkHash');
  for (const r of ex.rows) if (r[iCs]) exCallSite.set(r[iCs], (exCallSite.get(r[iCs]) || 0) + 1);
  const iE = cs.h.indexOf('expressionLinkHash'), iK = cs.h.indexOf('jsCallSiteUniqueHash');
  for (const r of cs.rows) {
    csRows++;
    if (!r[iE] || !exKeys.has(r[iE])) csNoExpr++;
    if ((exCallSite.get(r[iK]) || 0) !== 1) exprNoCs++;
  }
}
console.log(`3. call site <-> expr : ${csRows} call sites, ${csNoExpr} without an expression row, `
  + `${exprNoCs} without exactly one expression pointing back`);
if (csNoExpr || exprNoCs) fail('call-site/expression correspondence is not 1:1');

// ---- 4. type-only never reaches the call graph ----------------------------
let tr = 0, trBad = 0, csBad = 0, exBad = 0;
for (const d of packs) {
  const a = read(path.join(d, 'all-javascript-type-references.csv'));
  if (a) { const i = a.h.indexOf('isTypeOnly'); tr += a.rows.length; trBad += a.rows.filter(r => r[i] !== 'true').length; }
  const b = read(path.join(d, 'all-javascript-call-sites.csv'));
  if (b) { const i = b.h.indexOf('isTypeOnlyTarget'); csBad += b.rows.filter(r => r[i] !== 'false').length; }
  const c = read(path.join(d, 'all-javascript-expressions.csv'));
  if (c) { const i = c.h.indexOf('isTypeOnlyReachable'); exBad += c.rows.filter(r => r[i] !== 'false').length; }
}
console.log(`4. type-only isolation: ${tr} type refs (${trBad} not isTypeOnly), `
  + `${csBad} call sites isTypeOnlyTarget, ${exBad} expressions isTypeOnlyReachable`);
if (trBad || csBad || exBad) fail('a type-only construct reached the call graph');

// ---- 5. bundled files contribute zero rows to a coverage denominator ------
let bundledModules = 0;
for (const d of packs) {
  const m = read(path.join(d, 'all-javascript-modules.csv')); if (!m) continue;
  const i = m.h.indexOf('sourceProvenance');
  bundledModules += m.rows.filter(r => r[i] !== 'PROJECT').length;
}
console.log(`5. bundled classified : ${bundledModules} module(s) with non-PROJECT provenance`);
if (bundledModules === 0) fail('no bundled file was classified — the classifier is not being exercised, '
  + 'so its passing says nothing');

// ---- 5b. BUNDLED labels, it does not withhold (schema §3.1.1, 2026-09-13) ----
// A BUNDLED or GENERATED_MONOLITH module with no row in any other relation is a
// silent drop wearing a label. Only FLOW_REJECTED may stand alone. Accepts the
// pre-rename spellings so the gate measures whichever parser commit produced the tree.
const LABELS = new Set(['BUNDLED', 'BUNDLED_EXCLUDED', 'GENERATED_MONOLITH']);
let labelled = 0, labelledEmpty = 0; const emptyEx = [];
for (const d of packs) {
  const m = read(path.join(d, 'all-javascript-modules.csv')); if (!m) continue;
  const iP = m.h.indexOf('sourceProvenance'), iK = m.h.indexOf('jsModuleUniqueHash'), iF = m.h.indexOf('filePath');
  const want = new Map(m.rows.filter(r => LABELS.has(r[iP])).map(r => [r[iK], r[iF]]));
  if (!want.size) continue;
  labelled += want.size;
  const seen = new Set();
  for (const f of relations(d)) {
    if (f === 'all-javascript-modules.csv') continue;
    const c = read(path.join(d, f)); if (!c) continue;
    const i = c.h.indexOf('ownerModuleLinkHash'); if (i < 0) continue;
    for (const r of c.rows) if (want.has(r[i])) seen.add(r[i]);
  }
  for (const [k, f] of want) if (!seen.has(k)) { labelledEmpty++; if (emptyEx.length < 5) emptyEx.push(`${path.basename(d)}/${f}`); }
}
console.log(`5b. bundled emits     : ${labelled} labelled module(s), ${labelledEmpty} with no row in any other relation`);
if (labelledEmpty) fail(`a labelled module emitted nothing — a silent drop wearing a label: ${emptyEx.join(', ')}`);

console.log(`\n${fails === 0 ? 'ALL GATES PASS' : fails + ' GATE(S) FAILED'}`);

// ---- the negative control: corrupt a copy and require every gate to notice --
// Until 2026-09-13 this block printed a heading and injected nothing, so
// `--negative` reported the same PASS as the real run: the one shape of error
// this repo calls the most expensive. Now it copies the smallest package,
// plants one violation per gate, re-runs THIS file on the copy, and demands
// that each of the five gates reports FAIL. A gate that cannot fail here is a
// gate whose PASS above says nothing.
if (NEGATIVE) {
  const { execFileSync } = await import('child_process');
  const os = await import('os');
  const needed = ['all-javascript-modules.csv', 'all-javascript-call-sites.csv', 'all-javascript-type-references.csv'];
  const src = packs.filter(d => needed.every(f => (read(path.join(d, f))?.rows.length ?? 0) > 0))
    .map(d => [d, fs.readdirSync(d).reduce((n, f) => n + fs.statSync(path.join(d, f)).size, 0)])
    .sort((a, b) => a[1] - b[1])[0]?.[0];
  if (!src) { console.log('NEGATIVE CONTROL: no package has rows in all of ' + needed.join(', ')); process.exit(1); }
  // One fault per gate, each on its OWN fresh copy, so a fault that happens to
  // satisfy another gate (an orphan labelled module makes 5a pass) cannot mask it.
  const faults = [
    ['duplicate primary keys', 'all-javascript-modules.csv', c => { c.rows.push([...c.rows[0]]); }],
    ['dangling FKs', 'all-javascript-call-sites.csv', c => { c.rows[0][c.h.indexOf('expressionLinkHash')] = 'deadbeef-not-a-key'; }],
    ['call-site/expression correspondence', 'all-javascript-call-sites.csv', c => { c.rows[0][c.h.indexOf('expressionLinkHash')] = 'deadbeef-not-a-key'; }],
    ['a type-only construct reached the call graph', 'all-javascript-type-references.csv', c => { c.rows[0][c.h.indexOf('isTypeOnly')] = 'false'; }],
    ['no bundled file was classified', 'all-javascript-modules.csv', c => { const i = c.h.indexOf('sourceProvenance'); for (const r of c.rows) r[i] = 'PROJECT'; }],
    ['a labelled module emitted nothing', 'all-javascript-modules.csv', c => {
      const o = [...c.rows[0]]; o[c.h.indexOf('sourceProvenance')] = 'BUNDLED'; o[c.h.indexOf('jsModuleUniqueHash')] = 'JS_MODULE_orphan_with_no_rows'; c.rows.push(o); }],
  ];
  const missed = [];
  for (const [msg, file, plant] of faults) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-negative-'));
    const copy = path.join(tmp, path.basename(src));
    fs.cpSync(src, copy, { recursive: true });
    const c = read(path.join(copy, file)); if (!c) throw new Error(`negative control: ${file} is empty in ${src}`);
    plant(c);
    fs.writeFileSync(path.join(copy, file), [c.h.join('\t'), ...c.rows.map(r => r.join('\t'))].join('\n') + '\n');
    let out;
    try { out = execFileSync(process.execPath, [process.argv[1], tmp], { encoding: 'utf8', env: process.env }); }
    catch (e) { out = String(e.stdout); }
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!out.includes('FAIL ' + msg)) missed.push(msg);
  }
  console.log(`\nNEGATIVE CONTROL on ${path.basename(src)}: ${faults.length - missed.length}/${faults.length} planted faults caught, one fresh copy each`);
  for (const m of missed) console.log(`  NOT CAUGHT: ${m}`);
  if (missed.length) { console.log('  the gates above cannot fail on this shape — their PASS is void'); process.exit(1); }
}
process.exit(fails ? 1 : 0);
