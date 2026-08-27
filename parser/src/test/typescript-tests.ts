/**
 * TYPESCRIPT TESTS — one file, mirroring python-tests.ts.
 *
 *     npx tsx src/test/typescript-tests.ts            # everything
 *     npx tsx src/test/typescript-tests.ts --list     # what runs, and what it proves
 *
 * NO ts.Program, NO TypeChecker, NO NETWORK. Every check compares against
 * expectations frozen into src/test-data/typescript/_oracle, so this works anywhere
 * the project builds and it cannot be talked into a different answer.
 *
 * Deciding what the expectations SHOULD be needs a Program, a TypeChecker and the
 * pinned typescript@6.0.3. That lives in ../parser-oracle/typescript. Reach for it
 * only when a check here fails AND you believe the new behaviour is right.
 *
 * The split is the point. A suite that can rewrite its own expectations has a failure
 * mode indistinguishable from success — red, re-bless, green, with the defect now
 * recorded as intended, and every later fix reading as a regression. This file can
 * DETECT drift and cannot AUTHORISE it. It does not even import `typescript`, so it
 * has no way to recompute a truth it might prefer.
 */
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURES = 'src/test-data/typescript';
const ORACLE = path.join(FIXTURES, '_oracle');
const SCHEMA_DIR = 'src/schema/typescript';

/** The regime token the parser must stamp. Coarse on purpose: a version string in a
 *  primary key would cascade every hash on a patch bump (schema §4.1). */
const EMISSION_REGIME = 'ts6-inproc';
const COMPILER_VERSION = '6.0.3';

/**
 * Checks that cannot run until `ts-impl` lands the extractor.
 *
 * A skipped check that prints nothing is indistinguishable from a passing one, so the
 * count is ratcheted: it may FALL and never RISE. Lower this number in the same commit
 * that makes a check runnable — that way switching a check on is a visible diff rather
 * than a silent change of what the suite covers.
 */
const PENDING_BAR = 4;

interface Check { name: string; proves: string; run: () => number }
const fail = (m: string): number => { console.log('  ' + m); return 1; };

/** PENDING is not a pass. It is counted, ratcheted, and reported separately. */
let pending = 0;
const pendingNames: string[] = [];
function pendingCheck(name: string, why: string): number {
  pending++;
  pendingNames.push(name);
  console.log(`  PENDING — ${why}`);
  return 0;
}

function readJson<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

/** Is the extractor there yet? Absence is a fact to report, not a reason to be silent. */
function parserPresent(): boolean {
  return fs.existsSync('src/parsers/typescript') || fs.existsSync('src/workflows/typescript');
}

// ---------------------------------------------------------------------------
// 1. does the project COMPILE?
// ---------------------------------------------------------------------------

/**
 * First, because everything after it is meaningless otherwise. tsx transpiles without
 * typechecking, so a suite can run green over a tree `npm run build` cannot compile —
 * which happened in the Python work: 28 errors across a dozen commits, unnoticed.
 */
function compiles(): number {
  try {
    execFileSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], { encoding: 'utf-8' });
    console.log('  tsc --noEmit clean');
    return 0;
  } catch (e) {
    const out = String((e as { stdout?: string }).stdout ?? '');
    const errs = out.split('\n').filter((l) => l.includes('error TS'));
    console.log(`  ${errs.length} type error(s)`);
    for (const l of errs.slice(0, 10)) console.log('    ' + l);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// 2. do the FIXTURES compile, and are they isolated?
// ---------------------------------------------------------------------------

/**
 * A fixture that does not compile is a broken input, not a coverage gap.
 *
 * Two separate obligations, and the second is the one that bites. tsc has no opinion
 * about a program it rejected, so an expectation derived from a non-compiling fixture is
 * the oracle authorising noise. And if fixtures sit inside the repo's OWN program, one
 * broken fixture breaks `npm run build` and the Python gate's `tsc --noEmit` check —
 * a TypeScript fixture taking down an unrelated language's gate. All 20 fixtures were
 * in the root program when this suite was written; the exclusion is now load-bearing,
 * so it is asserted rather than assumed.
 */
/**
 * Every fixture directory with a tsconfig.json is its own program.
 *
 * One shared tsconfig cannot work: legacy decorators need `experimentalDecorators` and a
 * global-script merging fixture cannot have `isolatedModules`, and neither option may be
 * imposed on the rest of the corpus. The failure mode to guard against is subtler than a
 * compile error, though — EXCLUDING a directory from the one tsconfig also makes the
 * build green, while making the gate blind to those files. So this check compiles every
 * program AND asserts that no fixture is claimed by none of them.
 */
function fixtureCorpora(): string[] {
  const out: string[] = [];
  (function scan(dir: string) {
    if (path.basename(dir) === '_oracle') return;
    if (fs.existsSync(path.join(dir, 'tsconfig.json'))) out.push(dir);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.')) scan(path.join(dir, e.name));
    }
  })(FIXTURES);
  return out.sort();
}

function fixturesCompile(): number {
  const corpora = fixtureCorpora();
  if (!corpora.length) return fail(`no tsconfig.json under ${FIXTURES} — fixtures need a program`);

  const failures: string[] = [];
  let files = 0;
  for (const dir of corpora) {
    const cfg = path.join(dir, 'tsconfig.json');
    try {
      execFileSync('npx', ['tsc', '-p', cfg, '--noEmit', '--pretty', 'false'], { encoding: 'utf-8' });
    } catch (e) {
      const out = String((e as { stdout?: string }).stdout ?? '');
      const errs = out.split('\n').filter((l) => l.includes('error TS'));
      failures.push(`${path.relative(FIXTURES, dir) || '.'}: ${errs.length} type error(s) — ` +
        'a broken input, not a coverage gap');
      for (const l of errs.slice(0, 6)) console.log('    ' + l);
    }
  }
  files = fs.readdirSync(FIXTURES, { recursive: true } as { recursive: true })
    .filter((f) => /\.tsx?$/.test(String(f))).length;
  if (!failures.length) {
    console.log(`  ${files} fixture file(s) across ${corpora.length} program(s) compile clean`);
  }

  // Claimed by none: the exclusion trap.
  const corpora_ = readJson<{ unclaimedFiles: string[] }>(path.join(ORACLE, 'CORPORA.json'));
  if (corpora_?.unclaimedFiles?.length) {
    failures.push(`${corpora_.unclaimedFiles.length} fixture(s) are in NO program — excluded ` +
      'from every tsconfig, so the gate is blind to them. Excluding a fixture is not fixing it.');
    for (const f of corpora_.unclaimedFiles.slice(0, 8)) console.log(`    ${f}`);
  }

  // Isolation: the root program must not contain fixtures.
  const root = JSON.parse(fs.readFileSync('tsconfig.json', 'utf-8')) as { exclude?: string[] };
  const excluded = (root.exclude ?? []).some((x) => x.replace(/\\/g, '/').includes('test-data/typescript'));
  if (!excluded) {
    failures.push('root tsconfig.json does not exclude src/test-data/typescript — one ' +
      "erroring fixture would break npm run build and the Python gate's tsc check");
  } else {
    console.log('  fixtures are excluded from the root program');
  }

  for (const f of failures) console.log(`  ${f}`);
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 3. schema, generated .dl, and the doc agree
// ---------------------------------------------------------------------------

/** The `.dl` is generated from the schema doc. A hand-edit there is a silent schema break. */
function schemaMatchesDl(): number {
  const gen = path.join(SCHEMA_DIR, 'gen_decls.py');
  if (!fs.existsSync(gen)) return fail(`no ${gen}`);
  try {
    const out = execFileSync('python3', [gen, '--check'], { encoding: 'utf-8' });
    console.log('  ' + out.trim().split('\n').join('\n  '));
    return 0;
  } catch (e) {
    const err = String((e as { stdout?: string }).stdout ?? '') +
                String((e as { stderr?: string }).stderr ?? '');
    for (const l of err.split('\n').filter(Boolean).slice(0, 20)) console.log('  ' + l);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// 4. the frozen expectations are usable, non-vacuous, and not fabricated
// ---------------------------------------------------------------------------

interface Partition {
  emissionRegime: string;
  compilerVersion: string;
  mergeableKinds: string[];
  corpusFiles: { path: string; digest: string }[];
  quarantinedFiles: { path: string; reason: string }[];
  declarationSites: number;
  groups: { name: string; spaces: string[]; kinds: string[]; sites: string[] }[];
}

/**
 * What a declaration site may legally point at.
 *
 * Not a keyword check: tsc's node for `const key = 1` starts at `key`, the binding name,
 * not at `const`. So the falsifiable part is the TOKEN BOUNDARY — a real declaration site
 * begins a token, and an off-by-N column lands mid-identifier, on whitespace, on a
 * closing brace or inside a comment. That is what this catches, and it is enough to
 * refuse a fabricated position without the gate needing a parser of its own.
 */
const IDENT_CHAR = /[A-Za-z0-9_$]/;
const SITE_STARTS_TOKEN = /^[A-Za-z_$#"'[@]/;

/**
 * Can this suite trust the file it is about to compare against?
 *
 * The gate cannot RECOMPUTE the partition — that needs a Program, and having one here
 * would make re-blessing possible from inside the suite. But it can refuse an
 * expectation that is unusable or obviously fabricated, which is a different and
 * achievable claim:
 *
 *   - blessed under the pinned compiler and regime, or it is unattributable
 *   - NON-VACUOUS: contains a group with >1 declaration site. A merge-partition gate
 *     over singletons only would pass for a parser that ignores merging entirely —
 *     reporting success for exactly the thing it exists to check
 *   - every site names a file that exists, at a line that exists, whose text at that
 *     column plausibly starts a declaration
 *
 * That last one is why sites are `file:line:col` rather than hashes. A hash-based
 * expectation is unfalsifiable from here; a position is checkable against the source.
 */
function expectationsUsable(): number {
  const index = readJson<{ corpora: { slug: string; dir: string }[] }>(path.join(ORACLE, 'CORPORA.json'));
  if (!index) {
    return fail(`no ${path.join(ORACLE, 'CORPORA.json')} — bless from ../parser-oracle/typescript ` +
      '(npx tsx typescript/bless.ts)');
  }
  /**
   * Claimed by SOME corpus, globally.
   *
   * Quarantine is a property of the fixture tree, not of one corpus. A file in the
   * `staging` subtree that `staging`'s tsconfig excludes is perfectly fine if a nested
   * tsconfig compiles it — that is exactly the intended structure for fixtures needing
   * different compiler options. It is only a problem when NO program claims it, which is
   * what CORPORA.json's unclaimedFiles records.
   */
  const claimed = new Set<string>();
  for (const c of index.corpora) {
    const p = readJson<Partition>(path.join(ORACLE, c.slug, 'EXPECTED_MERGE_PARTITION.json'));
    for (const f of p?.corpusFiles ?? []) {
      claimed.add(path.normalize(path.join(FIXTURES, c.dir, f.path)));
    }
  }
  let bad = 0, mergedTotal = 0, sitesTotal = 0;
  for (const c of index.corpora) {
    bad += oneExpectation(c.slug, path.join(FIXTURES, c.dir), claimed,
      (m, s) => { mergedTotal += m; sitesTotal += s; });
  }
  console.log(`  ${index.corpora.length} corpus/corpora, ${sitesTotal} sites verified against ` +
    `source, ${mergedTotal} merged group(s)`);
  if (!mergedTotal) {
    console.log('  VACUOUS: no corpus has a group with more than one declaration site, so the ' +
      'merge gate would pass for a parser that ignores declaration merging');
    bad++;
  }
  return bad ? 1 : 0;
}

function oneExpectation(slug: string, corpusDir: string, claimedElsewhere: Set<string>,
                        tally: (merged: number, sites: number) => void): number {
  const file = path.join(ORACLE, slug, 'EXPECTED_MERGE_PARTITION.json');
  const p = readJson<Partition>(file);
  if (!p) return fail(`no ${file} — re-bless`);
  const failures: string[] = [];
  if (p.emissionRegime !== EMISSION_REGIME) {
    failures.push(`emissionRegime ${p.emissionRegime} != ${EMISSION_REGIME}`);
  }
  if (p.compilerVersion !== COMPILER_VERSION) {
    failures.push(`blessed under typescript@${p.compilerVersion}, this gate pins ${COMPILER_VERSION}`);
  }

  const merged = p.groups.filter((g) => g.sites.length > 1);

  // Is the expectation still ABOUT this corpus?
  //
  // Without this the file goes stale invisibly: a new fixture adds declarations the
  // frozen partition never mentions, and a gate that only validates the sites it already
  // knows reports success over an ungated file. This is not hypothetical — the corpus
  // grew from 35 files to 43 between blessing and the first run of this suite.
  const onDisk = fs.readdirSync(corpusDir, { recursive: true } as { recursive: true })
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => /\.tsx?$/.test(f))
    .sort();
  const blessed = new Map((p.corpusFiles ?? []).map((f) => [f.path, f.digest]));
  if (!p.corpusFiles) {
    failures.push('expectation has no corpusFiles — re-bless; it cannot be shown to be about this corpus');
  } else {
    const quarantined = new Set((p.quarantinedFiles ?? []).map((q) => q.path));
    for (const f of onDisk) {
      const want = blessed.get(f);
      if (want === undefined) {
        // Three outcomes, three owners. Compiled by a nested program: fine, and silent.
        // Declared quarantined and claimed by nobody: needs a tsconfig. Neither: the
        // expectation is stale and only the oracle may refresh it.
        if (claimedElsewhere.has(path.normalize(path.join(corpusDir, f)))) continue;
        if (quarantined.has(f)) {
          console.log(`  ${slug}: QUARANTINED ${f} — in no program, needs its own tsconfig`);
        } else {
          failures.push(`${f} is not covered by the expectation — re-bless from ../parser-oracle/typescript`);
        }
        continue;
      }
      const got = crypto.createHash('sha1').update(fs.readFileSync(path.join(corpusDir, f))).digest('hex');
      if (got !== want) failures.push(`${f} changed since blessing — re-bless`);
    }
    for (const f of blessed.keys()) {
      if (!onDisk.includes(f)) failures.push(`${f} is in the expectation but gone from the corpus — re-bless`);
    }

  }

  const seen = new Set<string>();
  let checked = 0;
  const cache = new Map<string, string[]>();
  for (const g of p.groups) {
    for (const s of g.sites) {
      if (seen.has(s)) { failures.push(`site ${s} appears in two groups — not a partition`); continue; }
      seen.add(s);
      const m = /^(.+):(\d+):(\d+)$/.exec(s);
      if (!m) { failures.push(`site ${s} is not file:line:col`); continue; }
      const [, rel, lineS, colS] = m;
      const abs = path.join(corpusDir, rel!);
      let lines = cache.get(abs);
      if (!lines) {
        if (!fs.existsSync(abs)) { failures.push(`site ${s} names a file that does not exist`); continue; }
        lines = fs.readFileSync(abs, 'utf-8').split('\n');
        cache.set(abs, lines);
      }
      const line = lines[Number(lineS) - 1];
      if (line === undefined) { failures.push(`site ${s}: file has ${lines.length} lines`); continue; }
      const col = Number(colS);
      const tail = line.slice(col - 1);
      const prev = col >= 2 ? line[col - 2] ?? '' : '';
      if (!SITE_STARTS_TOKEN.test(tail)) {
        failures.push(`site ${s}: column ${colS} is ${JSON.stringify(tail.slice(0, 24))}, ` +
          'which does not start a declaration token');
      } else if (IDENT_CHAR.test(prev)) {
        failures.push(`site ${s}: column ${colS} is mid-identifier (preceded by ` +
          `${JSON.stringify(prev)}) — an off-by-N position, not a declaration start`);
      }
      checked++;
    }
  }
  if (seen.size !== p.declarationSites) {
    failures.push(`declarationSites says ${p.declarationSites}, groups hold ${seen.size}`);
  }

  tally(merged.length, checked);
  for (const f of failures) console.log(`  ${slug}: ${f}`);
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 5. merge-shape coverage — reported, and only the vacuity case is gated
// ---------------------------------------------------------------------------

interface Coverage {
  covered: { shape: string; groups: number }[];
  uncovered: { shape: string; what: string; stresses: string }[];
}

/**
 * Which merge shapes the corpus exercises. Reported, not gated, with one exception:
 * zero covered shapes is the vacuity failure above.
 *
 * Not gated because the oracle authors no fixtures — the gap is a request to
 * `ts-fixtures`, and failing here would punish this suite for someone else's queue.
 * Reported loudly because a merge gate covering only overload sets leaves cross-file
 * merging, the case the schema's mergeScopeKey exists for, entirely untested.
 */
function mergeShapeCoverage(): number {
  const c = readJson<Coverage>(path.join(ORACLE, 'MERGE_SHAPE_COVERAGE.json'));
  if (!c) return fail('no MERGE_SHAPE_COVERAGE.json — bless it from ../parser-oracle/typescript');
  const total = c.covered.length + c.uncovered.length;
  console.log(`  ${c.covered.length}/${total} merge shapes covered: ` +
    c.covered.map((x) => `${x.shape}(${x.groups})`).join(' '));
  for (const u of c.uncovered) console.log(`  UNCOVERED ${u.shape.padEnd(21)} ${u.what}`);
  if (c.uncovered.some((u) => u.shape === 'MODULE_AUGMENTATION' || u.shape === 'INTERFACE_CROSS_FILE')) {
    console.log('  ^ cross-file merging is untested, which is the case mergeScopeKey exists for');
  }
  return c.covered.length ? 0 : 1;
}

// ---------------------------------------------------------------------------
// 6-9. parser-dependent checks
// ---------------------------------------------------------------------------

function mergePartition(): number {
  if (!parserPresent()) {
    return pendingCheck('merge partition',
      'no extractor yet — expectations are frozen and verified; the comparison needs ts-impl');
  }
  return fail('extractor present but this check is not wired — wire it and lower PENDING_BAR');
}

function tscAdjudicatedResolution(): number {
  if (!parserPresent()) {
    return pendingCheck('tsc-adjudicated resolution',
      'no extractor yet. 100% of 9,627 measured call sites have a getResolvedSignature ' +
      'answer, and 77.6% of overloaded calls resolve to a NON-first declaration, so this ' +
      'check is the one that turns resolution into a measurement');
  }
  return fail('extractor present but this check is not wired — wire it and lower PENDING_BAR');
}

function typeOnlyIsolation(): number {
  if (!parserPresent()) {
    return pendingCheck('type-only isolation',
      'no extractor yet. Asserts zero ts_call_site rows with isTypeOnlyTarget=true and ' +
      'zero ts_expression rows with isTypeOnlyReachable=true');
  }
  return fail('extractor present but this check is not wired — wire it and lower PENDING_BAR');
}

function tsxReservedButEmpty(): number {
  if (!parserPresent()) {
    return pendingCheck('TSX reserved but empty',
      'no extractor yet. TSX is out of freeze 1: JSX_COMPONENT_CALL is reserved and must ' +
      'carry ZERO rows, so switching TSX on shows up as a gate failure rather than as new rows');
  }
  return fail('extractor present but this check is not wired — wire it and lower PENDING_BAR');
}

// ---------------------------------------------------------------------------

const CHECKS: Check[] = [
  { name: 'compiles', proves: 'tsc --noEmit is clean — the suite reports on code that actually builds', run: compiles },
  { name: 'fixtures compile and are isolated', proves: 'a fixture is a valid input, and cannot break another language\'s gate', run: fixturesCompile },
  { name: 'schema and generated .dl agree', proves: 'the column contract in the doc is the one the engine reads', run: schemaMatchesDl },
  { name: 'frozen expectations are usable', proves: 'blessed under the pinned compiler, still about THIS corpus, non-vacuous, every site checks out', run: expectationsUsable },
  { name: 'merge-shape coverage', proves: 'which merge shapes the corpus actually exercises', run: mergeShapeCoverage },
  { name: 'merge partition', proves: 'the parser\'s declarationGroupKey partition equals tsc\'s symbol partition', run: mergePartition },
  { name: 'tsc-adjudicated resolution', proves: 'every resolved call target equals getResolvedSignature', run: tscAdjudicatedResolution },
  { name: 'type-only isolation', proves: 'no type-only construct reaches the call graph', run: typeOnlyIsolation },
  { name: 'TSX reserved but empty', proves: 'reserved enum values carry no rows until TSX is switched on', run: tsxReservedButEmpty },
];

function main(): number {
  if (process.argv.includes('--list')) {
    for (const c of CHECKS) console.log(`${c.name}\n  ${c.proves}`);
    return 0;
  }
  console.log('='.repeat(78));
  console.log('TypeScript suite — no ts.Program, no TypeChecker, no network');
  console.log('='.repeat(78));

  let failed = 0;
  for (const c of CHECKS) {
    console.log(`\n${c.name}`);
    const t0 = Date.now();
    let rc: number;
    try {
      rc = c.run();
    } catch (e) {
      rc = fail(`threw: ${(e as Error).message}`);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${rc ? 'FAIL' : 'PASS'}  (${secs}s)  ${c.proves}`);
    failed += rc ? 1 : 0;
  }

  console.log('\n' + '='.repeat(78));
  if (pending > PENDING_BAR) {
    console.log(`PENDING RATCHET BROKEN: ${pending} pending, bar is ${PENDING_BAR}`);
    console.log(`  ${pendingNames.join(', ')}`);
    failed++;
  } else if (pending < PENDING_BAR) {
    console.log(`${pending} pending, bar is ${PENDING_BAR} — lower PENDING_BAR to lock this in`);
  } else if (pending) {
    console.log(`${pending} check(s) PENDING on ts-impl: ${pendingNames.join(', ')}`);
    console.log('  Pending is not passing. The count may fall, never rise.');
  }
  console.log(`${CHECKS.length - failed}/${CHECKS.length} checks passed`);
  console.log('='.repeat(78));
  return failed ? 1 : 0;
}

process.exit(main());
