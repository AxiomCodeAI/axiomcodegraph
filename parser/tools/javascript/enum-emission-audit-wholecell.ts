/**
 * Enum-emission audit over the UNION of every corpus.
 *
 * Guards the two false positives already seen here:
 *  (1) a PREFIX value (`MODULE_EXPORTS:<hash>`) is invisible to exact-cell matching;
 *  (2) a value living in a different column than assumed reads as unemitted.
 * So the scan is: exact cell -> prefix cell -> substring cell, and it REPORTS the
 * relation AND column index where each value was found.
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * The repository whose `src/test/javascript-tests.ts` holds the allowlists.
 *
 * Defaults to the cwd because that is where `npx tsx` runs from; `JS_REPO`
 * overrides it when the audit is pointed at a checkout it is not inside — which
 * is the normal case for `js-corpus`, measuring a PUSHED js-impl commit from a
 * separate worktree.
 */
const __dirname_repo = process.env.JS_REPO ?? process.cwd();
import * as JsEnums from '@/enums/javascript';
import { RESERVED_CALL_KINDS } from '@/enums/javascript/call-sites';

const dirs = process.argv.slice(2);

interface Site { relation: string; column: string; how: string; count: number; sample: string }
const exact = new Map<string, Site>();
const prefix = new Map<string, Site>();
const substr = new Map<string, Site>();

const declaredValues = new Set<string>();
const declared = new Map<string, string[]>();
for (const [name, obj] of Object.entries(JsEnums as unknown as Record<string, unknown>)) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) continue;
  const vals = Object.values(obj as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
  if (vals.length) { declared.set(name, vals); vals.forEach(v => declaredValues.add(v)); }
}
if (declared.size === 0) { console.log('FATAL: no enums discovered — audit incapable of failing'); process.exit(1); }

let relationsScanned = 0;
for (const dir of dirs) {
  for (const sub of fs.readdirSync(dir)) {
    const d = path.join(dir, sub);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.startsWith('all-javascript-') || !f.endsWith('.csv')) continue;
      const p = path.join(d, f);
      if (fs.statSync(p).size === 0) continue;
      relationsScanned++;
      const rel = f.replace('all-javascript-', '').replace('.csv', '');
      const text = fs.readFileSync(p, 'utf8');
      const nl = text.indexOf('\n');
      const header = text.slice(0, nl).split('\t');
      let i = nl + 1;
      while (i < text.length) {
        let j = text.indexOf('\n', i); if (j < 0) j = text.length;
        const cells = text.slice(i, j).split('\t');
        for (let c = 0; c < cells.length; c++) {
          const cell = cells[c]!;
          if (cell === '') continue;
          const col = header[c] ?? `col${c}`;
          if (declaredValues.has(cell)) {
            const s = exact.get(cell);
            if (s) s.count++;
            else exact.set(cell, { relation: rel, column: col, how: 'exact', count: 1, sample: cell });
          } else if (cell.includes(':')) {
            const head = cell.slice(0, cell.indexOf(':'));
            if (declaredValues.has(head) && !prefix.has(head)) {
              prefix.set(head, { relation: rel, column: col, how: 'prefix', count: 1, sample: cell.slice(0, 60) });
            }
          }
        }
        i = j + 1;
      }
    }
  }
}

// third pass only for values still unseen: substring anywhere (catches embedded spellings)
const stillMissing = [...declaredValues].filter(v => !exact.has(v) && !prefix.has(v));
if (stillMissing.length) {
  const re = new RegExp('(' + stillMissing.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')');
  for (const dir of dirs) for (const sub of fs.readdirSync(dir)) {
    const d = path.join(dir, sub); if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.startsWith('all-javascript-') || !f.endsWith('.csv')) continue;
      const p = path.join(d, f); if (fs.statSync(p).size === 0) continue;
      const rel = f.replace('all-javascript-', '').replace('.csv', '');
      const text = fs.readFileSync(p, 'utf8');
      const nl = text.indexOf('\n'); const header = text.slice(0, nl).split('\t');
      for (const line of text.slice(nl + 1).split('\n')) {
        if (!re.test(line)) continue;
        const cells = line.split('\t');
        for (let c = 0; c < cells.length; c++) {
          for (const v of stillMissing) {
            if (cells[c]!.includes(v) && !substr.has(v)) {
              substr.set(v, { relation: rel, column: header[c] ?? `col${c}`, how: 'substring', count: 1, sample: cells[c]!.slice(0, 60) });
            }
          }
        }
      }
    }
  }
}

/**
 * js-impl's TWO allowlists, read from `src/test/javascript-tests.ts` rather than
 * copied here.
 *
 * A copy drifts, and the direction it drifts is always "the gate stops checking
 * something". Mine drifted within one commit: js-impl moved MIXED, BOUND and
 * NO_BODY from the zero-row list to the reported list, and my stale copy reported
 * a corpus with 44 legitimate MIXED rows as a reserved-value violation.
 *
 *   UNREACHABLE_BY_CONSTRUCTION — asserted at zero rows. Emitting one is a failure.
 *   MERELY_UNOBSERVED           — reachable, absent from their corpora. No
 *                                 assertion; observing one is NEWS for them.
 */
function loadAllowlists(): { unreachable: Set<string>; unobserved: Set<string> } {
  const src = fs.readFileSync(path.join(__dirname_repo, 'src/test/javascript-tests.ts'), 'utf8');
  const grab = (name: string): Set<string> => {
    const at = src.indexOf(`const ${name}:`);
    if (at < 0) { throw new Error(`${name} not found — the allowlist moved and this audit would pass vacuously`); }
    let i = src.indexOf('{', at), depth = 0, end = i;
    for (; end < src.length; end++) {
      if (src[end] === '{') { depth++; } else if (src[end] === '}') { depth--; if (depth === 0) { break; } }
    }
    const body = src.slice(i, end);
    const out = new Set<string>();
    for (const m of body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)) { out.add(m[1]!); }
    return out;
  };
  const unreachable = grab('UNREACHABLE_BY_CONSTRUCTION');
  for (const v of RESERVED_CALL_KINDS) { unreachable.add(v); }
  return { unreachable, unobserved: grab('MERELY_UNOBSERVED') };
}
const { unreachable: UNREACHABLE, unobserved: UNOBSERVED } = loadAllowlists();
console.log(`allowlists read from js-impl: UNREACHABLE_BY_CONSTRUCTION ${UNREACHABLE.size} `
  + `[${[...UNREACHABLE].join(', ')}], MERELY_UNOBSERVED ${UNOBSERVED.size} [${[...UNOBSERVED].join(', ')}]`);
if (UNREACHABLE.size === 0 || UNOBSERVED.size === 0) {
  console.log('FATAL: an allowlist parsed empty; the audit would report every reserved value as a gap');
  process.exit(1);
}

let declaredCount = 0, observed = 0;
const unemitted: Array<[string, string]> = [];
const reservedEmitted: Array<[string, string, Site]> = [];
const unobservedNowSeen: string[] = [];
for (const [ename, vals] of [...declared].sort()) {
  for (const v of vals) {
    declaredCount++;
    // A SUBSTRING hit inside free text is NOT an emission. It is a diagnostic.
    // (`JsDirectiveKind.USE_STRICT` read as emitted because `USE_STRICT_DIRECTIVE`
    // is a value of a DIFFERENT enum; `JSON_MODULE` matched a bundler's own source
    // text in `calleeText`. Both are this audit's own false-positive mode.)
    const site = exact.get(v) ?? prefix.get(v);
    if (site) {
      observed++;
      if (UNREACHABLE.has(v)) reservedEmitted.push([ename, v, site]);
      else if (UNOBSERVED.has(v)) unobservedNowSeen.push(`${ename}.${v} in ${site.relation}.${site.column}`);
    } else {
      unemitted.push([ename, v]);
    }
  }
}

console.log(`relations scanned: ${relationsScanned}`);
console.log(`declared enum values: ${declaredCount}   observed: ${observed}   unemitted: ${unemitted.length}`);
console.log(`  (exact ${exact.size}, PREFIX-only ${prefix.size}, SUBSTRING-only ${substr.size})`);
if (prefix.size) { console.log('\nvalues found ONLY as a prefix (false-positive guard 1):');
  for (const [v, s] of prefix) console.log(`  ${v}  -> ${s.relation}.${s.column}  e.g. ${s.sample}`); }
if (substr.size) { console.log('\nSUBSTRING DIAGNOSTICS — NOT counted as emitted; each needs column confirmation:');
  for (const [v, s] of substr) console.log(`  ${v}  -> ${s.relation}.${s.column}  e.g. ${s.sample}`); }
if (reservedEmitted.length) { console.log('\n*** RESERVED VALUES THAT WERE EMITTED ***');
  for (const [e, v, s] of reservedEmitted) console.log(`  ${e}.${v} in ${s.relation}.${s.column} (${s.how}, ${s.count} rows) e.g. ${s.sample}`); }
if (unobservedNowSeen.length) { console.log('\nNEWS for js-impl — on MERELY_UNOBSERVED and this corpus OBSERVES them:');
  for (const x of unobservedNowSeen) console.log('  ' + x); }
console.log('\nUNEMITTED (declared, never observed, not reserved):');
const byEnum = new Map<string, string[]>();
for (const [e, v] of unemitted) { if (UNREACHABLE.has(v)) continue; (byEnum.get(e) ?? byEnum.set(e, []).get(e)!).push(v); }
for (const [e, vs] of [...byEnum].sort()) console.log(`  ${e}: ${vs.join(', ')}`);
console.log('\nRESERVED and correctly carrying zero rows:');
for (const [e, v] of unemitted) if (UNREACHABLE.has(v)) console.log(`  ${e}.${v}`);
