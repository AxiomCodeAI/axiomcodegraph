/**
 * Isolate a js_parse_gap primary-key collision down to file, byte offset and the
 * two colliding diagnostic objects.
 *
 *     node src/test/javascript-gates/isolate-duplicate-diagnostic.mjs <file.js>
 *
 * Groups `sf.parseDiagnostics` by EXACTLY the five fields js_parse_gap keys on
 * (kind, module, line, column, detail), then field-by-field diffs the colliding
 * objects. The point of the diff is the null result: on every instance found so
 * far the two diagnostics differ in NOTHING, so no key built from content can
 * separate them.
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const ts = require_('typescript');
const TS_PINNED = '6.0.3';
if (ts.version !== TS_PINNED) { console.error(`typescript ${ts.version} != pinned ${TS_PINNED}`); process.exit(1); }
import fs from 'fs';
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
console.log(`typescript ${ts.version}  ScriptKind.JS  ${file}`);
console.log(`parseDiagnostics: ${sf.parseDiagnostics.length}`);

// group by EXACTLY the five fields js_parse_gap keys on
const groups = new Map();
sf.parseDiagnostics.forEach((d, idx) => {
  const lc = sf.getLineAndCharacterOfPosition(d.start);
  const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
  const key = `${d.code}|${lc.line + 1}|${lc.character + 1}|${msg}`;
  (groups.get(key) ?? groups.set(key, []).get(key)).push({ idx, d, lc, msg });
});
const dups = [...groups].filter(([, v]) => v.length > 1);
console.log(`distinct (code,line,col,message): ${groups.size}   colliding: ${dups.length}\n`);
if (!dups.length) { console.log('NO COLLISION IN THIS FILE'); process.exit(0); }

const [key, hits] = dups[0];
console.log(`=== FIRST COLLISION, ${hits.length} diagnostics ===`);
for (const { idx, d, lc, msg } of hits) {
  console.log(`  parseDiagnostics[${idx}]`);
  console.log(`    start (BYTE OFFSET) : ${d.start}`);
  console.log(`    length              : ${d.length}`);
  console.log(`    end                 : ${d.start + d.length}`);
  console.log(`    line:col (1-based)  : ${lc.line + 1}:${lc.character + 1}`);
  console.log(`    code                : ${d.code}`);
  console.log(`    category            : ${ts.DiagnosticCategory[d.category]}`);
  console.log(`    message             : ${msg}`);
  console.log(`    reportsUnnecessary  : ${d.reportsUnnecessary ?? '(absent)'}`);
  console.log(`    reportsDeprecated   : ${d.reportsDeprecated ?? '(absent)'}`);
  console.log(`    relatedInformation  : ${d.relatedInformation ? d.relatedInformation.length : '(absent)'}`);
  console.log(`    source text at start: ${JSON.stringify(src.slice(d.start, d.start + Math.max(d.length, 1)))}`);
  console.log(`    identical object?   : ${hits[0].d === d}`);
}
const [a, b] = hits;
console.log('\n  FIELD-BY-FIELD DIFF of the two diagnostic objects:');
const keys = new Set([...Object.keys(a.d), ...Object.keys(b.d)]);
let differs = 0;
for (const k of [...keys].sort()) {
  if (k === 'file') { console.log(`    ${k.padEnd(20)} same SourceFile object: ${a.d.file === b.d.file}`); continue; }
  const av = JSON.stringify(a.d[k]), bv = JSON.stringify(b.d[k]);
  if (av !== bv) { console.log(`    ${k.padEnd(20)} DIFFERS  ${av}  vs  ${bv}`); differs++; }
  else console.log(`    ${k.padEnd(20)} same     ${av}`);
}
console.log(`  -> ${differs} field(s) differ. ${differs === 0 ? 'The two diagnostics are indistinguishable by ANY own property.' : ''}`);
console.log(`\n  index distance in parseDiagnostics: ${Math.abs(a.idx - b.idx)} (adjacent = ${Math.abs(a.idx - b.idx) === 1})`);

console.log('\n=== ALL COLLISIONS IN THIS FILE ===');
for (const [k, v] of dups) {
  const [code, line, col, msg] = k.split('|');
  console.log(`  x${v.length}  code=${code} ${line}:${col} offsets=[${v.map(h => h.d.start).join(',')}] indices=[${v.map(h => h.idx).join(',')}]  ${msg.slice(0, 60)}`);
}
