/**
 * COLUMN-SCOPED enum-emission audit.
 *
 * The whole-cell audit has a third false-positive mode beyond the two already
 * recorded (prefix values, wrong-column assumptions): **35 of 264 distinct values
 * are declared in more than one enum.** `NONE` belongs to ten. Observing `NONE`
 * anywhere marks all ten covered, so an enum that never emits its own `NONE` is
 * invisible. This audit binds each enum to the COLUMNS that actually carry it,
 * derived from the data rather than assumed, and scores per (enum, column).
 *
 * Binding rule: a column binds to enum E when every distinct non-empty value in
 * that column is a member of E. Columns matching more than one enum, or none, are
 * reported rather than silently assigned.
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
const enums = new Map<string, Set<string>>();
for (const [n, o] of Object.entries(JsEnums as unknown as Record<string, unknown>)) {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) continue;
  const vs = Object.values(o as Record<string, unknown>).filter((v): v is string => typeof v === 'string');
  if (vs.length) enums.set(n, new Set(vs));
}
if (enums.size === 0) { console.log('FATAL: no enums'); process.exit(1); }
const enumsDeclaring = new Map<string, Set<string>>();
for (const [n, vs] of enums) for (const v of vs) (enumsDeclaring.get(v) ?? enumsDeclaring.set(v, new Set()).get(v)!).add(n);
const sharedValues = new Set([...enumsDeclaring].filter(([, es]) => es.size > 1).map(([v]) => v));
const bareSharedReservations = new Set<string>();

// distinct values per (relation, column)
const colValues = new Map<string, Set<string>>();
for (const dir of dirs) for (const sub of fs.readdirSync(dir)) {
  const d = path.join(dir, sub); if (!fs.statSync(d).isDirectory()) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.startsWith('all-javascript-') || !f.endsWith('.csv')) continue;
    const p = path.join(d, f); if (fs.statSync(p).size === 0) continue;
    const rel = f.replace('all-javascript-', '').replace('.csv', '');
    const t = fs.readFileSync(p, 'utf8'); const nl = t.indexOf('\n');
    const h = t.slice(0, nl).split('\t');
    for (const line of t.slice(nl + 1).split('\n')) {
      if (!line) continue;
      const cells = line.split('\t');
      for (let i = 0; i < cells.length && i < h.length; i++) {
        const v = cells[i]!; if (v === '') continue;
        const k = `${rel}.${h[i]}`;
        (colValues.get(k) ?? colValues.set(k, new Set()).get(k)!).add(v);
      }
    }
  }
}

// A run that observed nothing would report "INVARIANT HOLDS" over zero rows — it did,
// on 2026-09-13, when the audit was handed package directories instead of their
// parent and found no subdirectory carrying a relation. Refuse the vacuous verdict.
if (colValues.size === 0) {
  console.log(`FATAL: no relation rows found under ${dirs.join(', ')} — pass the directory that CONTAINS the package directories`);
  process.exit(2);
}

// bind columns to enums
const bound = new Map<string, string[]>();   // enum -> columns
const ambiguous: string[] = [];
for (const [col, vals] of colValues) {
  if (vals.size > 60) continue;                       // free text / hashes
  const hits = [...enums].filter(([, set]) => [...vals].every((v) => set.has(v)));
  if (hits.length === 0) continue;
  if (hits.length > 1) {
    // prefer the enum whose name best matches the column, else record ambiguity
    const colName = col.split('.')[1]!.toLowerCase();
    const best = hits.filter(([n]) => colName.includes(n.replace(/^Js/, '').toLowerCase()));
    if (best.length === 1) { (bound.get(best[0]![0]) ?? bound.set(best[0]![0], []).get(best[0]![0])!).push(col); continue; }
    ambiguous.push(`${col} -> ${hits.map((h) => h[0]).join(' | ')}`);
    for (const [n] of hits) (bound.get(n) ?? bound.set(n, []).get(n)!).push(col);
    continue;
  }
  (bound.get(hits[0]![0]) ?? bound.set(hits[0]![0], []).get(hits[0]![0])!).push(col);
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
    // TWO KEY FORMS. A bare `VALUE:` reserves the string in EVERY enum that
    // declares it — and 35 of 264 strings are declared in more than one. FIELD
    // is a value of four enums; reserving JsExportTargetKind.FIELD by bare name
    // asserts zero rows on JsCommentAttachmentKind.FIELD, which has thousands.
    // A quoted `'Enum.VALUE':` reserves one (enum, value) pair. The audit reads
    // both, scopes the quoted form exactly, and treats a bare key for a SHARED
    // string as what it is: ambiguous, and reported as such.
    const out = new Set<string>();
    for (const m of body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)) { out.add(m[1]!); }
    for (const m of body.matchAll(/^\s*['"]([A-Z][A-Za-z0-9]*)\.([A-Z][A-Z0-9_]*)['"]\s*:/gm)) {
      out.add(`${m[1]}.${m[2]}`);
    }
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
let declared = 0, observed = 0;
const unbound: string[] = [];
const gaps: Array<[string, string, string[]]> = [];
const reservedEmitted: Array<[string, string, string]> = [];
const unobservedStillAbsent: string[] = [];
const unobservedNowSeen: string[] = [];
for (const [name, vals] of [...enums].sort()) {
  const cols = bound.get(name);
  if (!cols) { unbound.push(name); continue; }
  const seen = new Set<string>();
  for (const c of cols) for (const v of colValues.get(c)!) seen.add(v);
  const miss: string[] = [];
  for (const v of vals) {
    declared++;
    const scoped = `${name}.${v}`;
    const isUnreachable = UNREACHABLE.has(scoped) || UNREACHABLE.has(v);
    const isUnobserved = UNOBSERVED.has(scoped) || UNOBSERVED.has(v);
    if (seen.has(v)) {
      observed++;
      if (isUnreachable) {
        reservedEmitted.push([name, v, cols.find((c) => colValues.get(c)!.has(v))!]);
        if (!UNREACHABLE.has(scoped) && sharedValues.has(v)) {
          bareSharedReservations.add(`${v} (bare; also declared by ${[...enumsDeclaring.get(v)!].filter((e) => e !== name).join(', ')})`);
        }
      }
      else if (isUnobserved) unobservedNowSeen.push(`${scoped} in ${cols.find((c) => colValues.get(c)!.has(v))!}`);
    } else if (!isUnreachable && !isUnobserved) miss.push(v);
      else if (isUnobserved) unobservedStillAbsent.push(scoped);
  }
  if (miss.length) gaps.push([name, cols.join(', '), miss]);
}
console.log(`enums bound to a column: ${bound.size} of ${enums.size}`);
console.log(`values in bound enums  : ${declared}   observed ${observed}   unobserved-and-not-reserved `
  + `${gaps.reduce((a, g) => a + g[2].length, 0)}`);
if (ambiguous.length) { console.log('\nAMBIGUOUS column bindings (reported, not guessed):');
  for (const a of ambiguous) console.log('  ' + a); }
if (unbound.length) console.log(`\nENUMS WITH NO BOUND COLUMN (${unbound.length}) — nothing in the corpus `
  + `emits any of their values in a column of their own:\n  ${unbound.join(', ')}`);
if (reservedEmitted.length) { console.log('\n*** RESERVED VALUES EMITTED IN THEIR OWN COLUMN ***');
  for (const [n, v, c] of reservedEmitted) console.log(`  ${n}.${v} in ${c}`); }
if (unobservedNowSeen.length) { console.log('\nNEWS for js-impl — on MERELY_UNOBSERVED and this corpus OBSERVES them:');
  for (const x of unobservedNowSeen) console.log('  ' + x); }
if (unobservedStillAbsent.length) console.log(`\nstill unobserved (correctly on MERELY_UNOBSERVED): ${unobservedStillAbsent.join(', ')}`);
console.log('\nPER-ENUM GAPS (value declared, never seen IN A COLUMN CARRYING THAT ENUM):');
for (const [n, cols, miss] of gaps) console.log(`  ${n}  [${cols}]\n      ${miss.join(', ')}`);

// ---------------------------------------------------------------------------
// THE INVARIANT, ASSERTED DIRECTLY. There is no GAP_BAR.
//
// §8 of BUILDING-A-PARSER.md: a ratchet may only fall, and when it reaches its
// floor it is DELETED and the invariant asserted in its place. The schema
// (§ "Two lists are not enough") records the column-scoped gap count reaching 0
// once USE_STRICT, FIELD and JSDOC are ruled, and says the bar is then deleted.
// This audit was the bar — it REPORTED gaps and asserted nothing — so deleting
// it means this block: every declared value is OBSERVED in a column carrying
// its enum, or it is on UNREACHABLE_BY_CONSTRUCTION with a zero-row assertion,
// or it is on MERELY_UNOBSERVED with a corpus note. Anything else is a failure
// with a name, and a reserved value that IS emitted is a failure with a name.
//
// A ruling that exists in prose and not in the two lists fails here. That is
// correct: the assertion is what makes the prose land.
// ---------------------------------------------------------------------------
let failures = 0;
if (bareSharedReservations.size > 0) {
  console.log(`\nAMBIGUOUS RESERVATION: a BARE key reserves a string declared by more than one enum, and`);
  console.log('  another enum emits it. Key the entry as \'Enum.VALUE\' to reserve one pair:');
  for (const x of bareSharedReservations) console.log(`  ${x}`);
}
if (reservedEmitted.length > 0) {
  failures += reservedEmitted.length;
  console.log(`\nFAIL: ${reservedEmitted.length} value(s) on UNREACHABLE_BY_CONSTRUCTION are emitted in their own column:`);
  for (const [n, v, c] of reservedEmitted) console.log(`  ${n}.${v} in ${c}`);
}
const gapValues = gaps.flatMap(([n, , miss]) => miss.map((v) => `${n}.${v}`));
if (gapValues.length > 0) {
  failures += gapValues.length;
  console.log(`\nFAIL: ${gapValues.length} declared value(s) are neither observed nor on either list:`);
  for (const v of gapValues) console.log(`  ${v}`);
  console.log('  Each needs one of: a corpus that reaches it, a MERELY_UNOBSERVED entry with a corpus');
  console.log('  note, or an UNREACHABLE_BY_CONSTRUCTION entry with a structural reason.');
}
console.log(failures === 0
  ? '\nINVARIANT HOLDS: every declared value is observed, or reserved with a written reason.'
  : `\nINVARIANT VIOLATED: ${failures} value(s). This audit no longer carries a bar to lower.`);
process.exit(failures === 0 ? 0 : 1);
