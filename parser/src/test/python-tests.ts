/**
 * PYTHON TESTS — one file, mirroring java-extractor-tests.ts.
 *
 *     npx tsx src/test/python-tests.ts            # everything
 *     npx tsx src/test/python-tests.ts --list     # what runs, and what it proves
 *
 * NO INTERPRETER, NO ORACLE, NO NETWORK. Every check runs the parser and compares
 * the result with expectations checked into src/test-data/python, so this works
 * anywhere the project builds.
 *
 * Deciding what the expectations SHOULD be is a different job needing CPython, a
 * pinned 3.10.4, a second 3.12 for PEP 695, and a mutation-tested harness. That
 * lives in ../parser-oracle/python. Reach for it only when a check here fails and
 * you believe the NEW behaviour is right.
 *
 * The split is deliberate. A suite that can rewrite its own expectations has a
 * failure mode indistinguishable from success — red, re-bless, green, with the
 * defect now recorded as intended. This file can DETECT drift and cannot
 * AUTHORISE it.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const VERIFIED = 'src/test-data/python/verified';
const GOLDEN = path.join(VERIFIED, '_golden');
const CLOSED_WORLD = 'src/test-data/python/closed-world';
const EDGES = 'src/test-data/python/categories/edge-cases';
const PY312 = 'src/test-data/python/verified-py312';

/** Columns that cannot be compared across runs or machines. */
const VOLATILE = /^(baseMservPath|filePath)$/;

// ---------------------------------------------------------------------------
// shared machinery — one copy, where there used to be three
// ---------------------------------------------------------------------------

function tsv(dir: string, file: string): Record<string, string>[] {
  const fp = path.join(dir, file);
  if (!fs.existsSync(fp)) return [];
  const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0]!.split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])) as Record<string, string>;
  });
}

async function analyse(rootDir: string, outputDir: string) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  return new PythonProjectAnalyzer().analyze({
    rootDir, outputDir, baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });
}

/** Every fact, sorted, volatile columns dropped. Row order is not a contract. */
function snapshot(out: string): Map<string, string[]> {
  const snap = new Map<string, string[]>();
  for (const f of fs.readdirSync(out).filter((x) => x.startsWith('all-python-'))) {
    const rows = tsv(out, f);
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]!).filter((c) => !VOLATILE.test(c));
    snap.set(
      f.replace('all-python-', '').replace('.csv', ''),
      rows.map((r) => cols.map((c) => `${c}=${r[c] ?? ''}`).join('\t')).sort()
    );
  }
  return snap;
}

interface Check { name: string; proves: string; run: () => Promise<number> }
const fail = (m: string) => { console.log('  ' + m); return 1; };

// ---------------------------------------------------------------------------
// 1. golden facts
// ---------------------------------------------------------------------------

/**
 * Rules the schema states outright, checked apart from the goldens.
 *
 * A golden catches UNINTENDED change. It cannot catch a violation that was
 * already present when the facts were frozen, and re-freezing after a real defect
 * would launder it into the baseline.
 */
function specViolations(work: string): string[] {
  const bad: string[] = [];
  // §2.12 c12: argumentCount is "" for BARE. A bare decorator has no argument
  // list at all, so 0 asserts "called with nothing", a different claim.
  const bare = tsv(work, 'all-python-decorators.csv')
    .filter((d) => d['kind'] === 'BARE' && d['argumentCount'] !== '');
  if (bare.length) {
    bad.push(`${bare.length} BARE decorator(s) carry argumentCount=` +
      `${JSON.stringify(bare[0]!['argumentCount'])}; §2.12 says "" for BARE`);
  }
  return bad;
}

async function goldenFacts(): Promise<number> {
  const WORK = '.py-test-out/golden';
  if (!fs.existsSync(GOLDEN)) return fail('no goldens — freeze them from ../parser-oracle/python');
  await analyse(VERIFIED, WORK);
  const now = snapshot(WORK);
  const files = fs.readdirSync(GOLDEN).filter((f) => f.endsWith('.golden'));
  const failures: string[] = [];
  let compared = 0;

  // Hash columns take part in the COMPARISON — PK stability is the contract —
  // but not in the EXPLANATION. Renaming one method cascades four scope hashes
  // through every row that references them, and the raw diff was 150 characters
  // of hex with the actual change truncated off the end.
  const readable = (l: string) => l.split('\t').filter((kv) => !/Hash=/.test(kv)).join('  ');

  for (const g of files) {
    const rel = g.replace('.golden', '');
    const want = fs.readFileSync(path.join(GOLDEN, g), 'utf-8').split('\n').filter(Boolean);
    const got = now.get(rel) ?? [];
    compared += want.length;
    const gotSet = new Set(got), wantSet = new Set(want);
    const lost = want.filter((l) => !gotSet.has(l));
    const gained = got.filter((l) => !wantSet.has(l));
    if (!lost.length && !gained.length) continue;
    failures.push(`${rel}: ${lost.length} fact(s) gone, ${gained.length} new`);
    for (const l of lost.slice(0, 5)) console.log(`    - ${rel}  ${readable(l).slice(0, 140)}`);
    for (const l of gained.slice(0, 5)) console.log(`    + ${rel}  ${readable(l).slice(0, 140)}`);
    if (lost.length === gained.length &&
        lost.every((l, i) => readable(l) === readable(gained[i] ?? ''))) {
      console.log(`      (all ${lost.length} differ only in hash columns — a key cascaded)`);
    }
  }
  for (const rel of now.keys()) {
    if (!files.includes(`${rel}.golden`)) failures.push(`${rel}: relation is NEW since freezing`);
  }
  const spec = specViolations(WORK);
  console.log(`  ${files.length} relations, ${compared} frozen facts`);
  for (const v of spec) console.log(`  SPEC VIOLATION: ${v}`);
  for (const f of failures) console.log(`  ${f}`);
  if (failures.length || spec.length) {
    console.log('  If the new behaviour is RIGHT, re-freeze:');
    console.log('    cd ../parser-oracle/python && npx tsx bless.ts');
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// 2. closed-world resolution
// ---------------------------------------------------------------------------

/**
 * Two tiers. HOPS is the parser's obligation and must be green: are the facts an
 * engine would need to resolve actually emitted? LINKED is partly the engine's
 * job — interprocedural argument flow, container element types — so it is
 * tracked rather than gated. A call that is unlinked but whose every hop is
 * present is not a parser defect; one whose hops are missing is, even if
 * something else happens to resolve it.
 */
async function closedWorld(): Promise<number> {
  const WORK = '.py-test-out/closed-world';
  const summary = await analyse(CLOSED_WORLD, WORK);
  const failures: string[] = [];
  if (summary.extractionErrors) failures.push(`${summary.extractionErrors} file(s) threw`);
  if (summary.filesRejected) failures.push(`${summary.filesRejected} file(s) rejected — all valid 3.10`);

  const calls = tsv(WORK, 'all-python-call-sites.csv');
  const exprs = tsv(WORK, 'all-python-expressions.csv');
  const byHash = new Map(exprs.map((e) => [e['pyExpressionUniqueHash']!, e]));
  const targets = exprs.filter((e) => e['edgeRole'] === 'ASSIGNMENT_TARGET');
  const values = exprs.filter((e) => e['edgeRole'] === 'ASSIGNMENT_VALUE');

  // §2.15: an ASSIGNMENT node parents both sides, and §2.10 deletes py_field_write
  // on the strength of "the sibling ASSIGNMENT_VALUE under the same parent".
  const orphanT = targets.filter((t) => !t['parentExpressionHash']).length;
  const orphanV = values.filter((v) => !v['parentExpressionHash']).length;
  if (orphanT || orphanV) {
    failures.push(`${orphanT} ASSIGNMENT_TARGET and ${orphanV} ASSIGNMENT_VALUE rows have no ` +
      'parent — nothing relates a name to what was assigned into it');
  }
  const badParent = [...targets, ...values].filter((e) => {
    const p = e['parentExpressionHash'];
    return p && byHash.get(p)?.['kind'] !== 'ASSIGNMENT';
  }).length;
  if (badParent) failures.push(`${badParent} assignment side(s) parented by a non-ASSIGNMENT node`);

  const unresolved = calls.filter((c) => !c['resolvedCalleeHash'] && c['resolvedCalleeKind'] !== 'BUILTIN');
  const linked = calls.filter((c) => c['resolvedCalleeHash']).length;
  console.log(`  ${calls.length} call sites, ${linked} linked, ${unresolved.length} unresolved (ceiling is 100%)`);
  if (unresolved.length) console.log(`  LINKED tier: ${unresolved.length} unlinked (tracked, not gated)`);
  for (const f of failures) console.log(`  HOPS FAIL: ${f}`);
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 3. open-edges ratchet
// ---------------------------------------------------------------------------

interface Bar { count: number; cases: string[] }

/**
 * Shapes that are locally resolvable IN PRINCIPLE and do not resolve yet. They
 * cannot join the goldens, which demand zero unresolved, and deleting them would
 * lose the only executable record of what is left to build. So the count may FALL
 * and never RISE.
 */
async function openEdges(): Promise<number> {
  const WORK = '.py-test-out/edges';
  const BAR = path.join(EDGES, 'EXPECTED_UNRESOLVED.json');
  await analyse(EDGES, WORK);
  const mods = tsv(WORK, 'all-python-modules.csv');
  const fileOf = new Map(mods.map((m) => [m['pyModuleUniqueHash']!, m['filePath']!]));
  const cases = tsv(WORK, 'all-python-call-sites.csv')
    .filter((c) => (fileOf.get(c['pyModuleLinkHash']!) ?? '').includes('OPEN_')
      && !c['resolvedCalleeHash'] && c['resolvedCalleeKind'] !== 'BUILTIN')
    .map((c) => `L${c['startLine']} ${c['receiverKind']}.${c['calleeName']}()  recv=${c['receiverText']}`)
    .sort();

  if (!fs.existsSync(BAR)) return fail('no ratchet bar — set it from ../parser-oracle/python');
  const bar = JSON.parse(fs.readFileSync(BAR, 'utf-8')) as Bar;
  console.log(`  ${cases.length} unresolved, bar is ${bar.count}`);
  if (cases.length > bar.count) {
    for (const g of cases.filter((c) => !bar.cases.includes(c))) console.log(`  + ${g}  STOPPED RESOLVING`);
    return 1;
  }
  if (cases.length < bar.count) {
    for (const f of bar.cases.filter((c) => !cases.includes(c))) console.log(`  - ${f}  now resolves`);
    console.log('  Lower the bar from ../parser-oracle/python to lock this in.');
  }
  return 0;
}

// ---------------------------------------------------------------------------
// 4. PEP 695 type parameters
// ---------------------------------------------------------------------------

interface TypeParamTruth {
  owner: string; ownerKind: string; name: string;
  position: number; bound: string; kind: string;
}

async function pep695(): Promise<number> {
  const WORK = '.py-test-out/pep695';
  const EXPECTED = path.join(PY312, 'EXPECTED_TYPE_PARAMETERS.json');
  const summary = await analyse(PY312, WORK);
  const failures: string[] = [];
  if (summary.filesRejected) failures.push(`${summary.filesRejected} file(s) REJECTED — 3.12 syntax must parse`);

  const want = (JSON.parse(fs.readFileSync(EXPECTED, 'utf-8')) as { rows: TypeParamTruth[] }).rows;
  const got = tsv(WORK, 'all-python-type-parameters.csv');
  const key = (o: string, n: string, p: string | number) => `${o}|${n}|${p}`;
  const map = new Map(got.map((g) => [key(g['ownerName']!, g['paramName']!, g['position']!), g]));

  let ok = 0;
  for (const w of want) {
    const g = map.get(key(w.owner, w.name, w.position));
    if (!g) { failures.push(`MISSING ${w.owner}[${w.name}] at ${w.position}`); continue; }
    if ((g['boundText'] ?? '') !== w.bound) {
      failures.push(`${w.owner}[${w.name}] bound: expected ${JSON.stringify(w.bound)}, got ${JSON.stringify(g['boundText'])}`);
    } else if ((g['ownerKind'] ?? '') !== w.ownerKind) {
      failures.push(`${w.owner}[${w.name}] ownerKind: expected ${w.ownerKind}, got ${g['ownerKind']}`);
    } else ok++;
  }
  for (const g of got) {
    const k = key(g['ownerName']!, g['paramName']!, g['position']!);
    if (!want.some((w) => key(w.owner, w.name, w.position) === k)) failures.push(`SPURIOUS ${k}`);
  }

  console.log(`  ${ok}/${want.length} type parameters match the frozen CPython 3.12 truth`);
  // Tracked, not failed: the enum declares TYPE_PARAM, TYPE_ALIAS and
  // TYPE_PARAM_BOUND and no extractor emits any of them, so §2.20's
  // pyScopeLinkHash points at the enclosing scope rather than the wrapper.
  const pepScopes = tsv(WORK, 'all-python-scopes.csv')
    .filter((s) => ['TYPE_PARAM', 'TYPE_ALIAS', 'TYPE_PARAM_BOUND'].includes(s['scopeKind'] ?? ''));
  if (!pepScopes.length) console.log('  KNOWN GAP — PEP 695 scope kinds declared, emitted by nothing');
  for (const f of failures) console.log(`  ${f}`);
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------

/**
 * Does the project COMPILE? First, because everything after it is meaningless
 * otherwise.
 *
 * tsx transpiles without typechecking, so every check here ran green over a tree
 * that `npm run build` could not compile — 28 errors, committed across a dozen
 * commits, and the suite never noticed. A test runner that passes on code which
 * does not build is not reporting on the same artifact anyone ships.
 */
async function compiles(): Promise<number> {
  try {
    execFileSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], { encoding: 'utf-8' });
    console.log('  tsc --noEmit clean');
    return 0;
  } catch (e) {
    const out = String((e as { stdout?: string }).stdout ?? '');
    const errs = out.split('\n').filter((l) => l.includes('error TS'));
    console.log(`  ${errs.length} type error(s)`);
    const byFile = new Map<string, number>();
    for (const l of errs) {
      const f = l.split('(')[0] ?? '?';
      byFile.set(f, (byFile.get(f) ?? 0) + 1);
    }
    for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`    ${String(n).padStart(3)}  ${f}`);
    }
    for (const l of errs.slice(0, 3)) console.log(`    ${l.slice(0, 130)}`);
    return 1;
  }
}

const CHECKS: Check[] = [
  { name: 'compiles', run: compiles,
    proves: 'tsc --noEmit is clean — the suite reports on code that actually builds' },
  { name: 'golden facts', run: goldenFacts,
    proves: 'no frozen fact moved; a failure names the row and the columns' },
  { name: 'closed-world resolution', run: closedWorld,
    proves: 'every hop an engine needs is present, on a corpus whose ceiling is 100%' },
  { name: 'open-edges ratchet', run: openEdges,
    proves: 'shapes resolvable in principle keep resolving; the count may fall, never rise' },
  { name: 'PEP 695 type parameters', run: pep695,
    proves: 'py_type_parameter matches frozen CPython 3.12 truth' },
];

async function main(): Promise<number> {
  if (process.argv.includes('--list')) {
    for (const c of CHECKS) console.log(`  ${c.name}\n      ${c.proves}`);
    return 0;
  }
  console.log('='.repeat(78));
  console.log(`PYTHON TESTS — ${CHECKS.length} checks`);
  console.log('='.repeat(78));
  const failed: string[] = [];
  for (const c of CHECKS) {
    const t0 = Date.now();
    let code = 1;
    console.log(`\n${c.name}`);
    try {
      code = await c.run();
    } catch (e) {
      console.log(`  THREW ${(e as Error).message}`);
    }
    console.log(`  ${code === 0 ? 'PASS' : 'FAIL'}  (${((Date.now() - t0) / 1000).toFixed(1)}s)  ${c.proves}`);
    if (code !== 0) failed.push(c.name);
  }
  fs.rmSync('.py-test-out', { recursive: true, force: true });
  console.log('\n' + '='.repeat(78));
  console.log(`${CHECKS.length - failed.length}/${CHECKS.length} checks passed`);
  for (const f of failed) console.log(`  FAILED  ${f}`);
  console.log('='.repeat(78));
  return failed.length ? 1 : 0;
}

if (require.main === module) main().then((c) => process.exit(c));
