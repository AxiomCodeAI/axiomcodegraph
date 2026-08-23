/**
 * GOLDEN GATE — a regression tripwire other agents can trust.
 *
 *     npx tsx src/test/python-oracle/golden-gate.ts --select   # who qualifies?
 *     npx tsx src/test/python-oracle/golden-gate.ts --promote  # copy into test-data
 *     npx tsx src/test/python-oracle/golden-gate.ts --bless    # freeze the facts
 *     npx tsx src/test/python-oracle/golden-gate.ts            # check (CI default)
 *
 * The point is that when someone changes the parser, the build tells them WHICH
 * FACT MOVED, not just that a number did. A percentage that drifts from 91.2 to
 * 90.8 is unactionable; "services/inheritance.py:14 py_call_site.resolvedCalleeKind
 * METHOD -> UNRESOLVED" is a bug report.
 *
 * ADMISSION RULE — 100% REACHABLE, MEASURED, NEVER JUDGED BY EYE.
 * A file is admitted only if EVERY call site in it either links to a declared
 * entity or is a builtin. That makes the ceiling exactly 100%, so any future
 * unresolved call is a regression rather than an argument about scope. Files that
 * exercise deliberately unresolvable constructs stay in staging where they belong —
 * they are good tests of behaviour and useless as a tripwire.
 *
 * TWO RULES THAT KEEP THIS HONEST
 *
 *   NOBODY HAND-WRITES EXPECTED FACTS. The parser proposes and the golden records.
 *   A hand-written expectation only tests whether its author and the implementer
 *   read the spec the same way.
 *
 *   --bless REFUSES IF THE ORACLE DISAGREES. Freezing unverified output would pin
 *   the bugs in place and make every future fix look like a regression. So CPython
 *   adjudicates the scopes and bindings first, and a disagreement blocks the freeze.
 */
import * as fs from 'fs';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const VERIFIED = 'src/test-data/python/verified';
const GOLDEN = path.join(VERIFIED, '_golden');
const WORK = '.golden-out';

/** Corpora searched for admissible files. */

/** Columns that cannot be compared across runs or machines. */
const VOLATILE = /^(baseMservPath|filePath)$/;

function tsv(dir: string, f: string): Record<string, string>[] {
  const fp = path.join(dir, f);
  if (!fs.existsSync(fp)) return [];
  const L = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  if (!L.length) return [];
  const h = L[0]!.split('\t');
  return L.slice(1).map((l) => {
    const c = l.split('\t');
    return Object.fromEntries(h.map((k, i) => [k, c[i] ?? ''])) as Record<string, string>;
  });
}

async function analyse(root: string, out: string) {
  fs.rmSync(out, { recursive: true, force: true });
  return new PythonProjectAnalyzer().analyze({
    rootDir: root, outputDir: out, baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });
}


/** The frozen form: every relation, sorted, volatile columns dropped. */
function snapshot(out: string): Map<string, string[]> {
  const snap = new Map<string, string[]>();
  for (const f of fs.readdirSync(out).filter((x) => x.startsWith('all-python-'))) {
    const rows = tsv(out, f);
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]!).filter((c) => !VOLATILE.test(c));
    const lines = rows
      .map((r) => cols.map((c) => `${c}=${r[c] ?? ''}`).join('\t'))
      .sort();                       // row order is not a contract; content is
    snap.set(f.replace('all-python-', '').replace('.csv', ''), lines);
  }
  return snap;
}

/**
 * Invariants the SPEC states outright, checked apart from the goldens.
 *
 * A golden catches UNINTENDED change. It cannot catch a violation that was
 * present when the facts were frozen, and re-blessing after a real defect would
 * launder it into the baseline — the next person would see a green gate over a
 * fact the schema forbids. These are stated rules, checked directly, every run.
 */
function specViolations(): string[] {
  const bad: string[] = [];
  const decorators = tsv(WORK, 'all-python-decorators.csv');
  // §2.12 c12: argumentCount is "" for BARE. A bare decorator has no argument
  // list at all, so 0 asserts "called with nothing", which is a different claim.
  const bareWithCount = decorators.filter(
    (d) => d['kind'] === 'BARE' && d['argumentCount'] !== '');
  if (bareWithCount.length) {
    bad.push(`${bareWithCount.length} BARE decorator(s) carry argumentCount=` +
      `${JSON.stringify(bareWithCount[0]!['argumentCount'])}; §2.12 says "" for BARE`);
  }
  return bad;
}

async function check(): Promise<number> {
  if (!fs.existsSync(GOLDEN)) {
    console.log('FAIL no goldens — run --promote then --bless');
    return 1;
  }
  await analyse(VERIFIED, WORK);
  const now = snapshot(WORK);
  const failures: string[] = [];
  const files = fs.readdirSync(GOLDEN).filter((f) => f.endsWith('.golden'));
  let compared = 0;
  for (const g of files) {
    const rel = g.replace('.golden', '');
    const want = fs.readFileSync(path.join(GOLDEN, g), 'utf-8').split('\n').filter(Boolean);
    const got = now.get(rel) ?? [];
    compared += want.length;
    const wantSet = new Set(want), gotSet = new Set(got);
    const lost = want.filter((l) => !gotSet.has(l));
    const gained = got.filter((l) => !wantSet.has(l));
    if (!lost.length && !gained.length) continue;
    failures.push(`${rel}: ${lost.length} fact(s) gone, ${gained.length} new`);
    // Render WITHOUT hash columns. Renaming one method moved four scope hashes and
    // every row that referenced them, so the raw diff was 150 characters of hex
    // with the actual change truncated off the end. Hashes still take part in the
    // COMPARISON — PK stability is the contract — they just do not take part in
    // the explanation.
    const readable = (l: string) => l.split('\t')
      .filter((kv) => !/Hash=/.test(kv))
      .join('  ');
    for (const l of lost.slice(0, 5)) console.log(`  - ${rel}  ${readable(l).slice(0, 140)}`);
    for (const l of gained.slice(0, 5)) console.log(`  + ${rel}  ${readable(l).slice(0, 140)}`);
    const hashOnly = lost.length === gained.length &&
      lost.every((l, i) => readable(l) === readable(gained[i] ?? ''));
    if (hashOnly) console.log(`    (all ${lost.length} differ only in hash columns — a key cascaded)`);
  }
  for (const rel of now.keys()) {
    if (!files.includes(`${rel}.golden`)) failures.push(`${rel}: relation is NEW since blessing`);
  }
  const spec = specViolations();
  console.log(`\ngolden gate — ${files.length} relations, ${compared} frozen facts`);
  if (spec.length) {
    console.log('\nSPEC VIOLATIONS — true whether or not the goldens moved:');
    for (const v of spec) console.log('  ' + v);
  }
  if (!failures.length && !spec.length) { console.log('PASS  every frozen fact still holds'); return 0; }
  if (!failures.length) { console.log('FAIL  goldens hold, but the spec does not'); return 1; }
  console.log('FAIL');
  for (const f of failures) console.log('  ' + f);
  console.log('\nIf the change is CORRECT, re-freeze from the oracle repository:');
  console.log('  cd ../parser-oracle/python && npx tsx bless.ts');
  console.log('That runs CPython first and refuses facts it disagrees with. This');
  console.log('repository cannot re-freeze on its own, by design.');
  return 1;
}

async function main(): Promise<number> {
  return check();
}
if (require.main === module) main().then((c) => process.exit(c));
export { main as goldenGate };
