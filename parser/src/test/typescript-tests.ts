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
 * DETECT drift and cannot AUTHORISE it.
 *
 * It now imports the PARSER, because four of its checks compare parser output against
 * the frozen expectations and there is no way to do that without running it. The
 * property that mattered is unchanged and is worth restating exactly: NOTHING here
 * constructs a `ts.Program` or a `TypeChecker`, so nothing here can recompute an
 * expectation. The parser cannot either — that is its own hardest rule — which is
 * why importing it does not hand this suite the ability to re-bless itself.
 */
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { IrCompletenessReport } from '@/parsers/typescript/extractors/ts-ir-completeness';
import { TypeScriptProjectAnalyzer } from '@/workflows/typescript/typescript-project-analyzer';

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
const PENDING_BAR = 0;

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

/**
 * Is the extractor there yet? Absence is a fact to report, not a reason to be silent.
 *
 * The probe is the ANALYZER, not the parser directory. Every check below needs
 * emitted rows, and rows come from the analyzer — the extractors underneath it
 * can exist and be individually verified long before there is anything to
 * compare a CSV against. Probing the directory instead would flip all four
 * checks to FAIL on the first extractor file, which turns "not built yet" into
 * a red gate and destroys the value of the ratchet: a suite that is red for
 * weeks teaches everyone to ignore it.
 *
 * The ratchet's intent is unchanged. A check may move from pending to live and
 * never back, and PENDING_BAR falls in the same commit that makes one runnable.
 */
function parserPresent(): boolean {
  return fs.existsSync('src/workflows/typescript/typescript-project-analyzer.ts');
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
// 5b. the resolution expectations are usable and can tell a wrong parser apart
// ---------------------------------------------------------------------------

interface CallExpectation {
  site: string; callKind: string; callee: string; target: string;
  targetProvenance: string; targetKind: string; targetHasBody: boolean;
  candidateCount: number; chosenIndex: number; choseNonFirst: boolean;
}
/** Declaration kinds that cannot carry a body. Grammar, not policy. */
const BODILESS_BY_CONSTRUCTION = new Set([
  'MethodSignature', 'CallSignature', 'ConstructSignature', 'FunctionType',
  'ConstructorType', 'PropertySignature', 'IndexSignature',
]);

interface Resolution {
  emissionRegime: string; compilerVersion: string;
  callSites: number; resolved: number; synthesized: number;
  overloadedCalls: number; choseNonFirst: number; calls: CallExpectation[];
}

/**
 * The flagship expectation, checked for the one property that makes it worth gating:
 * can it distinguish a correct parser from the most likely wrong one?
 *
 * The likely wrong implementation resolves a call by NAME and takes the first
 * declaration it finds. Measured on real code, that is wrong on 77.6% of overloaded
 * calls — so an expectation containing no call that resolves to a non-first declaration
 * would be green for exactly that parser. Counting call sites does not detect this;
 * counting NON-FIRST resolutions does.
 *
 * Two further properties are checked because they encode schema decisions that a
 * plausible-looking expectation could quietly violate:
 *
 *   bodiless targets  44.3% of real targets are `MethodSignature` — a declaration with
 *                     no body. If the expectation had none, `bodyPresence` would be
 *                     untested and the engine could read a .d.ts line as an implementation.
 *   external targets  must be SYMBOLIC (`lib:...#Owner.member`), never a position inside
 *                     node_modules, or every expectation churns on a dependency bump.
 */
function resolutionExpectationsUsable(): number {
  const index = readJson<{ corpora: { slug: string; dir: string }[] }>(path.join(ORACLE, 'CORPORA.json'));
  if (!index) return fail('no CORPORA.json — bless from ../parser-oracle/typescript');

  const failures: string[] = [];
  let calls = 0, nonFirst = 0, overloaded = 0, synth = 0, bodiless = 0, external = 0;

  for (const c of index.corpora) {
    const file = path.join(ORACLE, c.slug, 'EXPECTED_CALL_RESOLUTION.json');
    const r = readJson<Resolution>(file);
    if (!r) { failures.push(`${c.slug}: no EXPECTED_CALL_RESOLUTION.json — re-bless`); continue; }
    if (r.compilerVersion !== COMPILER_VERSION) {
      failures.push(`${c.slug}: blessed under typescript@${r.compilerVersion}, gate pins ${COMPILER_VERSION}`);
    }
    if (r.emissionRegime !== EMISSION_REGIME) {
      failures.push(`${c.slug}: emissionRegime ${r.emissionRegime} != ${EMISSION_REGIME}`);
    }
    calls += r.callSites; nonFirst += r.choseNonFirst;
    overloaded += r.overloadedCalls; synth += r.synthesized;

    const dir = path.join(FIXTURES, c.dir);
    for (const call of r.calls) {
      if (!call.targetHasBody) bodiless++;
      // Call sites are always positions in the corpus, and must check out.
      const m = /^(.+):(\d+):(\d+)$/.exec(call.site);
      if (!m) { failures.push(`${c.slug}: call site ${call.site} is not file:line:col`); continue; }
      const abs = path.join(dir, m[1]!);
      if (!fs.existsSync(abs)) { failures.push(`${c.slug}: ${call.site} names a missing file`); continue; }
      const line = fs.readFileSync(abs, 'utf-8').split('\n')[Number(m[2]) - 1];
      if (line === undefined) { failures.push(`${c.slug}: ${call.site} is past end of file`); continue; }

      // Internal consistency — rules the schema states outright, checkable with no
      // compiler. A gate that can only compare cannot notice an expectation that
      // contradicts itself, and the oracle is not infallible; it is merely better
      // informed. §4.6 c27: these kinds have no body BY CONSTRUCTION.
      if (BODILESS_BY_CONSTRUCTION.has(call.targetKind) && call.targetHasBody) {
        failures.push(`${c.slug}: ${call.site} -> ${call.targetKind} cannot have a body ` +
          '(§4.6 bodyPresence), yet targetHasBody is true');
      }
      if ((call.targetKind === 'NONE') !== (call.target === 'SYNTHESIZED_NO_DECLARATION')) {
        failures.push(`${c.slug}: ${call.site} has targetKind ${call.targetKind} but target ` +
          `${call.target} — a synthesized signature has no declaration node, and only those`);
      }

      if (call.target === 'SYNTHESIZED_NO_DECLARATION') continue;
      if (call.targetProvenance === 'PROJECT') {
        if (!/^.+:\d+:\d+$/.test(call.target)) {
          failures.push(`${c.slug}: project target ${call.target} is not a position`);
        }
      } else {
        external++;
        if (!/^(lib|pkg):[^#]+#.+/.test(call.target)) {
          failures.push(`${c.slug}: external target ${JSON.stringify(call.target)} is not ` +
            'symbolic — a node_modules position churns on every dependency bump');
        }
      }
    }
  }

  console.log(`  ${calls} call site(s): ${overloaded} overloaded, ${nonFirst} resolve to a ` +
    `NON-FIRST declaration, ${synth} synthesized, ${bodiless} bodiless target(s), ` +
    `${external} external`);
  if (!nonFirst) {
    failures.push('VACUOUS: no call resolves to a non-first declaration, so a parser that ' +
      'resolves by name and takes the first would pass — wrong on 77.6% of real overloaded calls');
  }
  if (!bodiless) {
    failures.push('no bodiless target: 44.3% of real targets are MethodSignature, so ' +
      'bodyPresence would be untested and a .d.ts line could be read as an implementation');
  }
  for (const f of failures) console.log(`  ${f}`);
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 6-9. parser-dependent checks
// ---------------------------------------------------------------------------

/**
 * Runs the extractor over every corpus, once, and caches the output.
 *
 * One run per corpus DIRECTORY, not one over the fixture root, because a program
 * is the unit of merge scope: `staging/tsconfig.json` excludes three subtrees
 * that have their own configs, and analysing them together would merge two
 * global scopes tsc keeps apart. That is the same partition the expectations
 * were blessed under.
 */
let extractionCache: Map<string, string> | undefined;
let completenessCache: Map<string, IrCompletenessReport> | undefined;

/**
 * Runs the extractor over every corpus, ONCE, before any check reads a row.
 *
 * Awaited up front rather than lazily inside a check, and that is not a style
 * choice. Extraction is asynchronous; a check that fired it and read the output
 * in the same tick would compare against files that do not exist yet, find no
 * rows, and PASS — the exact failure mode this suite exists to rule out. Doing
 * it here makes "the extractor ran" a precondition of the checks rather than
 * something each of them has to remember.
 */
async function extractAllCorpora(): Promise<void> {
  const cache = new Map<string, string>();
  const completeness = new Map<string, IrCompletenessReport>();
  const index = readJson<{ corpora: { slug: string; dir: string }[] }>(
    path.join(ORACLE, 'CORPORA.json'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-gate-'));
  for (const c of index?.corpora ?? []) {
    const outputDir = path.join(root, c.slug);
    fs.mkdirSync(outputDir, { recursive: true });
    const rootDir = path.join(FIXTURES, c.dir);
    const summary = await new TypeScriptProjectAnalyzer().analyze({
      rootDir,
      outputDir,
      baseMservPath: rootDir,
      serviceVersionLink: 'ts-gate',
    });
    cache.set(c.slug, outputDir);
    completeness.set(c.slug, summary.irCompleteness);
  }
  extractionCache = cache;
  completenessCache = completeness;
}

function completenessByCorpus(): Map<string, IrCompletenessReport> {
  if (!completenessCache) {
    throw new Error('extraction has not run — extractAllCorpora() must be awaited first');
  }
  return completenessCache;
}

function extractedCorpora(): Map<string, string> {
  if (!extractionCache) {
    throw new Error('extraction has not run — extractAllCorpora() must be awaited first');
  }
  return extractionCache;
}

/** Reads one emitted relation. A missing file and an empty one are the same fact here. */
function relation(outputDir: string, filename: string): Record<string, string>[] {
  const file = path.join(outputDir, filename);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0]!.split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row: Record<string, string> = {};
    head.forEach((name, i) => { row[name] = cells[i] ?? ''; });
    return row;
  });
}

/** `file:line:col`, the position convention the expectations use throughout. */
function site(row: Record<string, string>): string {
  return `${row.filePath}:${row.startLine}:${row.startColumn}`;
}

// ---------------------------------------------------------------------------
// 6. merge partition
// ---------------------------------------------------------------------------

/**
 * The declaration kinds tsc's partition covers, mapped from what the parser emits.
 *
 * A class EXPRESSION is deliberately absent: it declares nothing in any symbol
 * table, so it is not in tsc's partition either and including it would produce
 * an "extra" site for a row that is perfectly correct.
 */
const TYPE_CATEGORY_TO_DECLARATION_KIND: Record<string, string> = {
  CLASS_TYPE: 'ClassDeclaration',
  INTERFACE_TYPE: 'InterfaceDeclaration',
  ENUM_TYPE: 'EnumDeclaration',
  CONST_ENUM_TYPE: 'EnumDeclaration',
  TYPE_ALIAS_TYPE: 'TypeAliasDeclaration',
  NAMESPACE_TYPE: 'ModuleDeclaration',
};

/**
 * `declarationGroupKey` partitions the declarations exactly as tsc's symbols do.
 *
 * Set equality in BOTH directions, which is the whole point: a parser that
 * splits one merged interface into two groups and a parser that joins two
 * distinct symbols into one are different bugs, and a one-directional check
 * catches only the first. §3.1 says nothing downstream is trustworthy until
 * this passes, so it is the first check that looks at emitted rows.
 */
function mergePartition(): number {
  if (!parserPresent()) {
    return pendingCheck('merge partition',
      'no extractor yet — expectations are frozen and verified; the comparison needs ts-impl');
  }
  const index = readJson<{ corpora: { slug: string; dir: string }[] }>(
    path.join(ORACLE, 'CORPORA.json'));
  if (!index) return fail('no CORPORA.json');
  const corpora = extractedCorpora();
  const failures: string[] = [];
  let sites = 0, groups = 0, merged = 0;

  for (const c of index.corpora) {
    const outputDir = corpora.get(c.slug);
    const expected = readJson<Partition>(
      path.join(ORACLE, c.slug, 'EXPECTED_MERGE_PARTITION.json'));
    if (!outputDir || !expected) { failures.push(`${c.slug}: no extraction or expectation`); continue; }

    const byGroup = new Map<string, string[]>();
    const record = (groupKey: string, where: string): void => {
      const list = byGroup.get(groupKey);
      if (list) { list.push(where); } else { byGroup.set(groupKey, [where]); }
    };
    for (const row of relation(outputDir, 'all-typescript-types.csv')) {
      if (TYPE_CATEGORY_TO_DECLARATION_KIND[row.typeCategory ?? '']) {
        record(row.declarationGroupKey ?? '', site(row));
      }
    }
    for (const row of relation(outputDir, 'all-typescript-methods.csv')) {
      if (row.methodKind === 'FUNCTION_DECLARATION') {
        record(row.declarationGroupKey ?? '', site(row));
      }
    }
    for (const row of relation(outputDir, 'all-typescript-variables.csv')) {
      // A destructured binding's declaration node is a BindingElement, which is
      // not one of tsc's mergeable kinds. The parser records the enclosing
      // VariableDeclaration with an empty name, so an empty name is exactly the
      // set to skip.
      if (row.name !== '') {
        record(row.declarationGroupKey ?? '', site(row));
      }
    }

    const canonical = (list: string[]): string => [...list].sort().join(' | ');
    const mineParts = new Set([...byGroup.values()].map(canonical));
    const theirParts = new Set(expected.groups.map((g) => canonical(g.sites)));
    const mineSites = new Set([...byGroup.values()].flat());
    const theirSites = new Set(expected.groups.flatMap((g) => g.sites));

    for (const s of theirSites) {
      if (!mineSites.has(s)) failures.push(`${c.slug}: tsc declares a symbol at ${s}, parser emits no row`);
    }
    for (const s of mineSites) {
      if (!theirSites.has(s)) failures.push(`${c.slug}: parser emits a declaration at ${s}, tsc declares none`);
    }
    for (const p of theirParts) {
      if (!mineParts.has(p)) failures.push(`${c.slug}: tsc groups [${p.slice(0, 120)}], parser SPLITS it`);
    }
    for (const p of mineParts) {
      if (!theirParts.has(p)) failures.push(`${c.slug}: parser groups [${p.slice(0, 120)}], tsc does not`);
    }
    sites += mineSites.size;
    groups += byGroup.size;
    merged += [...byGroup.values()].filter((g) => g.length > 1).length;
  }

  console.log(`  ${sites} declaration site(s) in ${groups} group(s), ${merged} of them merged ` +
    '— set equality with tsc, both directions');
  if (!merged) {
    failures.push('VACUOUS: the parser produced no group with more than one site, so this ' +
      'check would pass for a parser that ignores declaration merging entirely');
  }
  for (const f of failures.slice(0, 12)) console.log(`  ${f}`);
  if (failures.length > 12) console.log(`  … and ${failures.length - 12} more`);
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 7. tsc-adjudicated resolution
// ---------------------------------------------------------------------------

/**
 * A NON-REGRESSION guard on same-file links. Emphatically not a target.
 *
 * The parser emits IR; the engine builds the call graph. Java resolves **0** of
 * its 67,938 type references — no Java extractor contains a statement that fills
 * `referencedTypeRegistryLinkHash` — so a resolution percentage is not a quality
 * measure here and driving this number up is not progress. The quality measure
 * is IR COMPLETENESS, checked separately and gated hard.
 *
 * What this guards is narrower and still worth guarding: the links the parser
 * DOES emit, all of them resolvable inside one file with no import following,
 * are strictly more than Java provides and save the engine a lookup. Losing them
 * by accident should be visible.
 *
 * It was 310 while the parser followed imports across files. That was
 * `type-resolution.dl` rewritten in TypeScript and has been retracted, so the
 * number is 283 and the drop is a POLICY CHANGE, recorded here rather than
 * smoothed over. It may fall again only with the same kind of note.
 */
/**
 * Member rows of an anonymous SHAPE whose owner FK is still empty (schema §4.8.1).
 *
 * `{ toCsv(): string }` has member rows and, until the schema said where the owner goes,
 * nowhere to put it. `ts_field` c8 and `ts_method` c7 now point at `ts_type_reference`
 * when the kind is shape-owned, so this is a parser obligation and may only fall.
 *
 * Deliberately NOT a blanket "owner must be non-empty" rule. Measured, 416 rows have an
 * empty owner and they are three different things: 259 anonymous shape members that must
 * be filled, 137 where `""` is CORRECT (a MODULE_INITIALIZER is owned by the module, a
 * free arrow by the variable that binds it), and 20 object-literal members whose owner is
 * an EXPRESSION — a separate and still unmeasured gap, OQ-10. Asserting non-emptiness
 * everywhere would demand a wrong answer for 157 of them.
 */
const SHAPE_OWNER_UNFILLED_BAR = 259;

/** Kinds whose owner is an anonymous shape, so c8 / c7 must hold a ts_type_reference. */
const SHAPE_OWNED_FIELD_KINDS = new Set([
  'TYPE_LITERAL_PROPERTY', 'TYPE_LITERAL_INDEX_SIGNATURE',
  // Emitted today as the interface-member values even inside a type literal. Both sets
  // are listed so this works before AND after ts-impl adopts the new enum values.
  'PROPERTY_SIGNATURE', 'INDEX_SIGNATURE',
]);
const SHAPE_OWNED_METHOD_KINDS = new Set([
  'TYPE_LITERAL_METHOD_SIGNATURE', 'TYPE_LITERAL_CALL_SIGNATURE',
  'TYPE_LITERAL_CONSTRUCT_SIGNATURE',
  'FUNCTION_TYPE_SIGNATURE', 'CONSTRUCTOR_TYPE_SIGNATURE',
  'METHOD_SIGNATURE', 'CALL_SIGNATURE', 'CONSTRUCT_SIGNATURE',
]);

const SAME_FILE_LINK_FLOOR = 304;


/**
 * Every parser-filled `resolvedSignatureLinkHash` equals `getResolvedSignature`.
 *
 * Position-precise, and the asymmetry is deliberate: a filled target that
 * disagrees with tsc is a HARD FAILURE, while an unfilled one is counted and
 * reported. §4.15 licenses exactly that split — the parser fills columns 12–18
 * only where resolution is syntactically decidable, and the guess it declines to
 * make becomes a number rather than a silence.
 *
 * The other half is just as load-bearing: where tsc says the target is EXTERNAL
 * or SYNTHESIZED, the parser must not have claimed a project signature. A parser
 * that resolves `value.trim()` to a project method of that name would otherwise
 * score well and be wrong about the call graph.
 */
function tscAdjudicatedResolution(): number {
  if (!parserPresent()) {
    return pendingCheck('tsc-adjudicated resolution',
      'no extractor yet; the expectations are blessed and verified');
  }
  const index = readJson<{ corpora: { slug: string; dir: string }[] }>(
    path.join(ORACLE, 'CORPORA.json'));
  if (!index) return fail('no CORPORA.json');
  const corpora = extractedCorpora();
  const failures: string[] = [];
  let expectedCalls = 0, emittedCalls = 0, projectTargets = 0, agreed = 0, unfilled = 0;
  const byReceiver = new Map<string, { total: number; filled: number }>();

  for (const c of index.corpora) {
    const outputDir = corpora.get(c.slug);
    const expected = readJson<Resolution>(
      path.join(ORACLE, c.slug, 'EXPECTED_CALL_RESOLUTION.json'));
    if (!outputDir || !expected) { failures.push(`${c.slug}: no extraction or expectation`); continue; }

    const modulePath = new Map(relation(outputDir, 'all-typescript-modules.csv')
      .map((m) => [m.tsModuleUniqueHash ?? '', m.filePath ?? '']));
    const methodSite = new Map(relation(outputDir, 'all-typescript-methods.csv')
      .map((m) => [m.tsMethodUniqueHash ?? '', site(m)]));

    // A MULTISET keyed by position. `new Foo().bar()` puts two call sites at one
    // offset — the outer call and the inner construction both begin at `new` —
    // so a plain map would drop one and quietly shrink the comparison.
    const emitted = new Map<string, Record<string, string>[]>();
    for (const row of relation(outputDir, 'all-typescript-call-sites.csv')) {
      const key = `${modulePath.get(row.tsModuleLinkHash ?? '') ?? '?'}:${row.startLine}:${row.startColumn}`;
      const list = emitted.get(key);
      if (list) { list.push(row); } else { emitted.set(key, [row]); }
      emittedCalls += 1;
      const bucket = byReceiver.get(row.receiverKind ?? '') ?? { total: 0, filled: 0 };
      bucket.total += 1;
      if (row.resolvedSignatureLinkHash !== '') bucket.filled += 1;
      byReceiver.set(row.receiverKind ?? '', bucket);
    }

    for (const call of expected.calls) {
      expectedCalls += 1;
      const candidates = emitted.get(call.site);
      const row = candidates?.shift();
      if (!row) {
        failures.push(`${c.slug}: tsc sees a call at ${call.site} (${call.callee}), parser emits none`);
        continue;
      }
      const filled = (row.resolvedSignatureLinkHash ?? '') !== '';
      if (call.targetProvenance === 'PROJECT') {
        projectTargets += 1;
        if (!filled) { unfilled += 1; continue; }
        const got = methodSite.get(row.resolvedSignatureLinkHash ?? '') ?? '<unknown>';
        if (got === call.target) { agreed += 1; } else {
          failures.push(`${c.slug}: ${call.site} (${call.callee}) — tsc resolves to ` +
            `${call.target}, parser claims ${got}`);
        }
        continue;
      }
      if (filled) {
        const got = methodSite.get(row.resolvedSignatureLinkHash ?? '') ?? '<unknown>';
        failures.push(`${c.slug}: ${call.site} (${call.callee}) — tsc resolves to ` +
          `${call.targetProvenance} ${call.target}, parser claims the project signature ${got}`);
      }
    }
    for (const [where, leftover] of emitted) {
      if (leftover.length > 0) {
        failures.push(`${c.slug}: parser emits ${leftover.length} extra call site(s) at ${where}`);
      }
    }
  }

  const shapes = [...byReceiver.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([shape, b]) => `${shape} ${b.filled}/${b.total}`)
    .join('  ');
  console.log(`  ${emittedCalls} call site(s) emitted for ${expectedCalls} tsc sees; ` +
    `${projectTargets} project targets: ${agreed} agree, ${unfilled} left to the engine, ` +
    `${failures.length} disagree`);
  // PROVENANCE, not a score. The unfilled column is where the ENGINE resolves,
  // which is the design; see `IR completeness` for the number that matters.
  console.log(`  provenance — same-file links by receiver shape: ${shapes}`);
  if (agreed < SAME_FILE_LINK_FLOOR) {
    failures.push(`REGRESSION: ${agreed} adjudicated same-file links, floor is ` +
      `${SAME_FILE_LINK_FLOOR}. Losing a link the parser used to emit is a defect; note that ` +
      'the floor is a non-regression guard and NOT a target — see its comment.');
  } else if (agreed > SAME_FILE_LINK_FLOOR) {
    console.log(`  ${agreed} > floor ${SAME_FILE_LINK_FLOOR} — raise SAME_FILE_LINK_FLOOR if ` +
      'this is meant to stay');
  }
  for (const f of failures.slice(0, 12)) console.log(`  ${f}`);
  if (failures.length > 12) console.log(`  … and ${failures.length - 12} more`);
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 8. type-only isolation
// ---------------------------------------------------------------------------

/**
 * No type-only construct reaches the call graph.
 *
 * Three assertions, and the third is the one a column check cannot make. The two
 * tripwire columns say the parser did not MARK anything as type-only-reachable;
 * a fixture that declares itself `type-only` and still produces a call site says
 * the containment actually failed, whatever the columns claim.
 *
 * The fixture's own header is the source of truth for its nature, which keeps
 * this suite from inventing the classification it is checking.
 */
function typeOnlyIsolation(): number {
  if (!parserPresent()) {
    return pendingCheck('type-only isolation',
      'no extractor yet. Asserts zero ts_call_site rows with isTypeOnlyTarget=true and ' +
      'zero ts_expression rows with isTypeOnlyReachable=true');
  }
  const index = readJson<{ corpora: { slug: string; dir: string }[] }>(
    path.join(ORACLE, 'CORPORA.json'));
  if (!index) return fail('no CORPORA.json');
  const corpora = extractedCorpora();
  const failures: string[] = [];
  const misdeclared = new Set<string>();
  let typeOnlyFixtures = 0, callSites = 0, expressions = 0;

  for (const c of index.corpora) {
    const outputDir = corpora.get(c.slug);
    if (!outputDir) continue;
    const oracleCallSites = new Set(
      (readJson<Resolution>(path.join(ORACLE, c.slug, 'EXPECTED_CALL_RESOLUTION.json'))
        ?.calls ?? []).map((call) => call.site));
    const modulePath = new Map(relation(outputDir, 'all-typescript-modules.csv')
      .map((m) => [m.tsModuleUniqueHash ?? '', m.filePath ?? '']));

    // The fixtures declare their own nature in a header line, so the corpus
    // says which files may not produce call-graph rows.
    const typeOnlyFiles = new Set<string>();
    for (const [, filePath] of modulePath) {
      if (filePath === '') continue;
      const abs = path.join(FIXTURES, c.dir, filePath);
      if (!fs.existsSync(abs)) continue;
      const head = fs.readFileSync(abs, 'utf-8').slice(0, 600);
      if (/^\/\/\s*nature:\s*type-only\s*$/m.test(head)) typeOnlyFiles.add(filePath);
    }
    typeOnlyFixtures += typeOnlyFiles.size;

    for (const row of relation(outputDir, 'all-typescript-call-sites.csv')) {
      callSites += 1;
      if (row.isTypeOnlyTarget !== 'false') {
        failures.push(`${c.slug}: ts_call_site at ${row.startLine}:${row.startColumn} has ` +
          'isTypeOnlyTarget=true — a type-only construct reached the call graph');
      }
      const file = modulePath.get(row.tsModuleLinkHash ?? '') ?? '';
      if (typeOnlyFiles.has(file)) {
        // Two different defects wear the same shape here, and only one is the
        // parser's. If TSC ALSO sees a call at this position the file is not
        // type-only and its header is wrong — a request to ts-fixtures, and
        // failing for it would punish this suite for someone else's queue. If
        // tsc sees nothing there, the parser invented a call-graph row out of a
        // type-only construct, which is exactly what §3.3 forbids.
        const where = `${file}:${row.startLine}:${row.startColumn}`;
        if (oracleCallSites.has(where)) {
          misdeclared.add(`${c.slug}: ${file} declares itself type-only, but tsc resolves a ` +
            `call at ${row.startLine}:${row.startColumn} — the fixture header is wrong`);
        } else {
          failures.push(`${c.slug}: ${file} is type-only and tsc sees no call at ` +
            `${row.startLine}:${row.startColumn}, yet the parser emitted one — a type-only ` +
            'construct reached the call graph');
        }
      }
    }
    for (const row of relation(outputDir, 'all-typescript-expressions.csv')) {
      expressions += 1;
      if (row.isTypeOnlyReachable !== 'false') {
        failures.push(`${c.slug}: ts_expression at ${row.startLine}:${row.startColumn} has ` +
          'isTypeOnlyReachable=true');
      }
    }
  }

  console.log(`  ${expressions} expression(s), ${callSites} call site(s), ` +
    `${typeOnlyFixtures} self-declared type-only fixture(s) — none reached the call graph`);
  // Reported loudly and not gated, exactly as merge-shape coverage is: the
  // fixture's nature is ts-fixtures' to declare, and a suite that fails for a
  // wrong header teaches people to delete the header.
  for (const m of misdeclared) console.log(`  MISDECLARED ${m}`);
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 10. fact-base invariants
// ---------------------------------------------------------------------------

/**
 * The structural invariants from the schema's Appendix B, checked on real output.
 *
 * Every one of these has the same failure signature and it is the worst kind:
 * the fact base still loads, every join still succeeds, and a count is silently
 * wrong. A duplicate primary key does not collide — it DOUBLES. A dangling FK
 * does not error — it drops a row from an inner join. Neither shows up in a
 * comparison against expectations unless the comparison happens to cover the
 * exact row involved.
 *
 * This check earned its place immediately: it found duplicate `ts_expression`
 * keys from a member decorator being walked down two paths, and it named the
 * relation and the key. The resolution comparison had noticed the same bug only
 * as "7 extra call sites", which is a symptom three inferences away from the
 * cause.
 */
function factBaseInvariants(): number {
  if (!parserPresent()) {
    return pendingCheck('fact-base invariants',
      'no extractor yet. Asserts PK uniqueness, FK integrity, and the tree invariants');
  }
  const corpora = extractedCorpora();
  const failures: string[] = [];
  const systemsSeen = new Set<string>();
  let rows = 0, links = 0, shapeOwnerUnfilled = 0;

  for (const [slug, outputDir] of corpora) {
    // DERIVED from the emitted files, never listed. A hand-maintained list goes
    // stale the moment a relation is added, and the way it goes stale is the
    // worst available: the new relation's PKs are absent from `known`, so every
    // FK pointing at them is reported as DANGLING. A real check then produces a
    // false failure, which is how a correct parser gets debugged for an hour.
    const all = new Map<string, Record<string, string>[]>();
    for (const file of fs.readdirSync(outputDir)) {
      if (file.startsWith('all-typescript-') && file.endsWith('.csv')) {
        all.set(file, relation(outputDir, file));
      }
    }

    // 2. Every PK is unique within its relation.
    const known = new Set<string>();
    for (const [file, relationRows] of all) {
      rows += relationRows.length;
      const seen = new Set<string>();
      const keyColumn = Object.keys(relationRows[0] ?? {}).slice(-1)[0] ?? '';
      for (const row of relationRows) {
        const key = row[keyColumn] ?? '';
        if (seen.has(key)) {
          failures.push(`${slug}: ${file} has a DUPLICATE primary key ${key.slice(0, 40)} ` +
            `(row at ${row.startLine}:${row.startColumn}) — duplicate keys double a count, ` +
            'they do not collide');
        }
        seen.add(key);
        known.add(key);
      }
    }

    // 1. Every non-empty FK resolves to an existing PK.
    for (const [file, relationRows] of all) {
      for (const row of relationRows) {
        for (const [column, value] of Object.entries(row)) {
          if (!column.endsWith('LinkHash') && !column.endsWith('OwnerHash')
            && !column.endsWith('ReferenceHash') && !column.endsWith('ExpressionHash')) {
            continue;
          }
          if (column === 'serviceVersionLinkHash' || value === '') continue;
          links += 1;
          if (!known.has(value)) {
            failures.push(`${slug}: ${file}.${column} = ${value.slice(0, 40)} resolves to no ` +
              'primary key — a dangling FK drops rows from an inner join without erroring');
          }
        }
      }
    }

    // 7. depth = 0 if and only if parentReferenceHash is empty.
    for (const row of all.get('all-typescript-type-references.csv') ?? []) {
      const isRoot = (row.parentReferenceHash ?? '') === '';
      if (isRoot !== (row.depth === '0')) {
        failures.push(`${slug}: ts_type_reference at ${row.startLine}:${row.startColumn} has ` +
          `depth=${row.depth} and parent=${row.parentReferenceHash === '' ? '""' : 'set'} ` +
          '— type-hierarchy rules depend on those agreeing');
      }
    }

    // 6. childCount matches the rows that point back, unless truncated.
    const childrenOf = new Map<string, number>();
    for (const row of all.get('all-typescript-type-references.csv') ?? []) {
      const parent = row.parentReferenceHash ?? '';
      if (parent !== '') childrenOf.set(parent, (childrenOf.get(parent) ?? 0) + 1);
    }
    for (const row of all.get('all-typescript-type-references.csv') ?? []) {
      const declared = Number(row.childCount ?? '0');
      const actual = childrenOf.get(row.tsTypeReferenceUniqueHash ?? '') ?? 0;
      if (declared !== actual && row.isTruncated !== 'true') {
        failures.push(`${slug}: ts_type_reference ${row.completeTypeName?.slice(0, 30)} at ` +
          `${row.startLine}:${row.startColumn} declares childCount=${declared} but ${actual} ` +
          'rows point at it');
      }
    }

    // 8. One call site per CALL / NEW / TAGGED_TEMPLATE expression, exactly.
    const callShaped = (all.get('all-typescript-expressions.csv') ?? [])
      .filter((r) => r.kind === 'CALL_EXPRESSION' || r.kind === 'NEW_EXPRESSION'
        || r.kind === 'TAGGED_TEMPLATE').length;
    const callSites = (all.get('all-typescript-call-sites.csv') ?? []).length;
    if (callShaped !== callSites) {
      failures.push(`${slug}: ${callShaped} call-shaped expression(s) but ${callSites} ` +
        'ts_call_site row(s) — the 1:1 chain is broken');
    }

    // 3. An anonymous shape's members carry their owner FK (schema §4.8.1).
    //
    // Scoped to the shape-owned kinds, because "" is the CORRECT answer for a
    // module initializer or a free arrow — see SHAPE_OWNER_UNFILLED_BAR. A row
    // that IS filled must point at a ts_type_reference and not a ts_type: an
    // anonymous shape has no declaration, and inventing one would create a type
    // the source does not declare.
    for (const row of all.get('all-typescript-fields.csv') ?? []) {
      if (!SHAPE_OWNED_FIELD_KINDS.has(row.memberKind ?? '')) continue;
      const owner = row.tsTypeLinkHash ?? '';
      if (owner === '') { shapeOwnerUnfilled += 1; continue; }
      if ((row.memberKind ?? '').startsWith('TYPE_LITERAL_')
        && !owner.startsWith('TS_TYPE_REFERENCE')) {
        failures.push(`${slug}: ts_field ${row.name} at ${row.startLine}:${row.startColumn} is ` +
          `${row.memberKind} but its owner is not a ts_type_reference — a type-literal member ` +
          'is owned by the SHAPE, not by a declaration');
      }
    }
    for (const row of all.get('all-typescript-methods.csv') ?? []) {
      if (!SHAPE_OWNED_METHOD_KINDS.has(row.methodKind ?? '')) continue;
      const owner = row.tsTypeLinkHash ?? '';
      if (owner === '') { shapeOwnerUnfilled += 1; continue; }
      const kind = row.methodKind ?? '';
      const mustBeShape = kind.startsWith('TYPE_LITERAL_')
        || kind === 'FUNCTION_TYPE_SIGNATURE' || kind === 'CONSTRUCTOR_TYPE_SIGNATURE';
      if (mustBeShape && !owner.startsWith('TS_TYPE_REFERENCE')) {
        failures.push(`${slug}: ts_method ${row.name} at ${row.startLine}:${row.startColumn} is ` +
          `${kind} but its owner is not a ts_type_reference`);
      }
    }

    // 4. The type-only tripwires, restated where the other invariants live.
    for (const row of all.get('all-typescript-call-sites.csv') ?? []) {
      if (row.isTypeOnlyTarget !== 'false') {
        failures.push(`${slug}: ts_call_site.isTypeOnlyTarget is not false`);
      }
    }

    // Every CALLABLE OR CONSTRUCTABLE expression must have a declaration row at
    // the same position.
    //
    // An arrow, a function expression and a class expression are all
    // declarations as well as expressions, and the declaration is what carries
    // the parameters, the members and the signature a call site resolves to. A
    // row on one side and nothing on the other is a callable with expression
    // identity and no declaration — invisible in every count, because both
    // relations look healthy on their own.
    //
    // Two real gaps had exactly this shape: declarations inside a DECORATOR
    // ARGUMENT (`@record((v) => v, class Inline {})`), which the declaration
    // walk never reached, and the inner arrow of a CURRIED arrow
    // (`(a) => (b) => c`), which a `forEachChild` descent steps straight past.
    const declaredAt = new Set<string>();
    for (const file of ['all-typescript-methods.csv', 'all-typescript-types.csv']) {
      for (const row of all.get(file) ?? []) {
        declaredAt.add(`${row.filePath}:${row.startLine}:${row.startColumn}`);
      }
    }
    const filePathByModule = new Map((all.get('all-typescript-modules.csv') ?? [])
      .map((m) => [m.tsModuleUniqueHash ?? '', m.filePath ?? '']));
    for (const row of all.get('all-typescript-expressions.csv') ?? []) {
      if (row.kind !== 'ARROW_FUNCTION' && row.kind !== 'FUNCTION_EXPRESSION'
        && row.kind !== 'CLASS_EXPRESSION') {
        continue;
      }
      const where = `${filePathByModule.get(row.tsModuleLinkHash ?? '') ?? '?'}:` +
        `${row.startLine}:${row.startColumn}`;
      if (!declaredAt.has(where)) {
        failures.push(`${slug}: a ${row.kind} at ${where} has an expression row but NO ` +
          'declaration row — a callable with expression identity and no declaration');
      }
    }

    // A PARAMETER decorator is legal ONLY under experimentalDecorators. That is
    // grammar, not policy, so a parameter decorator stamped STANDARD_TC39 means
    // the decorator system was read from somewhere other than the tsconfig that
    // governs the file — which is the failure this column exists to prevent.
    for (const row of all.get('all-typescript-decorators.csv') ?? []) {
      systemsSeen.add(row.decoratorSystem ?? '');
      if (row.context === 'PARAMETER_DECLARATION'
        && row.decoratorSystem !== 'LEGACY_EXPERIMENTAL') {
        failures.push(`${slug}: parameter decorator at ${row.startLine}:${row.startColumn} is ` +
          `stamped ${row.decoratorSystem} — parameter decorators exist only under ` +
          'experimentalDecorators, so decoratorSystem did not come from the governing tsconfig');
      }
    }
  }

  // Both systems must actually be exercised, or the column is untested: a
  // parser hard-coding either value would pass a corpus that only uses that one.
  if (systemsSeen.size > 0 && !(systemsSeen.has('STANDARD_TC39')
    && systemsSeen.has('LEGACY_EXPERIMENTAL'))) {
    console.log(`  VACUOUS for decoratorSystem: only ${[...systemsSeen].join(', ')} observed, ` +
      'so a parser assuming one system per run would pass');
  }

  console.log(`  ${rows} row(s), ${links} foreign key(s): every PK unique, every FK resolves, ` +
    'every type-node tree well-formed, call sites 1:1');
  console.log(`  decoratorSystem observed: ${[...systemsSeen].sort().join(', ') || 'none'} ` +
    '— read per file from the governing tsconfig');
  console.log('  every callable expression has a declaration row at the same position');
  if (shapeOwnerUnfilled > SHAPE_OWNER_UNFILLED_BAR) {
    failures.push(`${shapeOwnerUnfilled} anonymous-shape member(s) have an empty owner FK, ` +
      `bar is ${SHAPE_OWNER_UNFILLED_BAR}. The slot EXISTS (schema §4.8.1: c8/c7 point at ` +
      'ts_type_reference for a shape-owned kind), so this is a parser obligation and the ' +
      'count may only fall');
  } else if (shapeOwnerUnfilled < SHAPE_OWNER_UNFILLED_BAR) {
    console.log(`  ${shapeOwnerUnfilled} shape member(s) without an owner FK (< bar ` +
      `${SHAPE_OWNER_UNFILLED_BAR}) — lower SHAPE_OWNER_UNFILLED_BAR; at 0, delete it and ` +
      'assert 0 outright');
  } else if (shapeOwnerUnfilled) {
    console.log(`  ${shapeOwnerUnfilled} anonymous-shape member(s) await their owner FK ` +
      '(schema §4.8.1) — until c8/c7 is filled the shape is reachable only through a ' +
      'one-way memberGroupKey hash');
  }
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  if (failures.length > 10) console.log(`  … and ${failures.length - 10} more`);
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 9. TSX reserved but empty
// ---------------------------------------------------------------------------

/**
 * Reserved enum values carry ZERO rows.
 *
 * TSX is out of freeze 1 (§4.15.1). The representation is decided — a JSX
 * element IS a call to its component, with the whole props object as argument 0
 * — and nothing emits it. The point of checking the emptiness is that the day
 * TSX is switched on it shows up HERE, as a gate failure naming the value, and
 * not as new rows appearing in a fact base with nobody noticing.
 */
const RESERVED_TSX_VALUES = new Set([
  'JSX_COMPONENT_CALL', 'JSX_ELEMENT', 'JSX_SELF_CLOSING',
  'JSX_ATTRIBUTE_VALUE', 'JSX_CHILD',
]);

function tsxReservedButEmpty(): number {
  if (!parserPresent()) {
    return pendingCheck('TSX reserved but empty',
      'no extractor yet. TSX is out of freeze 1: JSX_COMPONENT_CALL is reserved and must ' +
      'carry ZERO rows, so switching TSX on shows up as a gate failure rather than as new rows');
  }
  const corpora = extractedCorpora();
  const failures: string[] = [];
  let checked = 0;
  const columns: [string, string[]][] = [
    ['all-typescript-call-sites.csv', ['callKind']],
    ['all-typescript-expressions.csv', ['kind', 'edgeRole']],
  ];
  for (const [slug, outputDir] of corpora) {
    for (const [file, names] of columns) {
      for (const row of relation(outputDir, file)) {
        checked += 1;
        for (const name of names) {
          const value = row[name] ?? '';
          if (RESERVED_TSX_VALUES.has(value)) {
            failures.push(`${slug}: ${file} row at ${row.startLine}:${row.startColumn} carries ` +
              `reserved value ${name}=${value} — TSX is not in freeze 1`);
          }
        }
      }
    }
  }
  console.log(`  ${checked} row(s) checked; ${RESERVED_TSX_VALUES.size} reserved value(s) ` +
    'carry none of them');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 11. IR completeness — the primary quality measure
// ---------------------------------------------------------------------------

/**
 * Every hop an engine needs in order to resolve is present.
 *
 * THIS is the measure, and resolution rate is not. The parser emits IR; the
 * engine builds the call graph. Java's own numbers settle it: 0 of 67,938
 * `java_type_reference` rows carry a resolved link, and no Java extractor
 * contains a statement that would fill one. `type-resolution.dl` does the work.
 *
 * So the question is not "what fraction did the parser resolve" but "for every
 * call the parser left alone, can the engine finish?" For a receiver whose
 * declared type lives in another file that means three facts and no more: the
 * declared type NAME as written, the importing module, and
 * `ts_import.resolvedFilePath`. The measure verifies those, plus the hop chain
 * from the call site to the declaration that carries the annotation.
 *
 * Gated on `handedOffIncomplete == 0`. A call the parser did not resolve is
 * fine; a call the ENGINE cannot resolve because a fact is missing is not.
 */
function irCompleteness(): number {
  if (!parserPresent()) {
    return pendingCheck('IR completeness',
      'no extractor yet. Asserts that every hop an engine needs in order to resolve is emitted');
  }
  const index = readJson<{ corpora: { slug: string; dir: string }[] }>(
    path.join(ORACLE, 'CORPORA.json'));
  if (!index) return fail('no CORPORA.json');

  let callSites = 0, links = 0, terminals = 0, complete = 0, incomplete = 0;
  let inferred = 0, notDerivable = 0;
  const gaps: string[] = [];
  for (const c of index.corpora) {
    const report = completenessByCorpus().get(c.slug);
    if (!report) {
      return fail(`${c.slug}: no completeness report — extraction did not run`);
    }
    callSites += report.callSites;
    links += report.sameFileLinks;
    terminals += report.terminals;
    complete += report.handedOffComplete;
    incomplete += report.handedOffIncomplete;
    inferred += report.inferredReceiver;
    notDerivable += report.notDerivable;
    for (const gap of report.gaps) {
      gaps.push(`${c.slug}: ${gap.where} (${gap.detail}) — ${gap.reason}`);
    }
  }
  const accounted = links + terminals + complete + incomplete + inferred + notDerivable;

  console.log(`  ${callSites} call site(s), all accounted for: ${links} same-file links, ` +
    `${terminals} terminals, ${complete} handed off COMPLETE, ${incomplete} handed off ` +
    'INCOMPLETE');
  console.log(`  ${inferred} inferred receiver (no annotation exists), ${notDerivable} not ` +
    'derivable from syntax; every IIFE callee reaches its ts_method through c16');
  if (accounted !== callSites) {
    // Every call site must land in exactly one bucket. A total that does not add
    // up means a case is counted twice or not at all, and either way the
    // headline number is meaningless — which is how a double-count survived one
    // revision of this measure.
    gaps.push(`buckets sum to ${accounted} for ${callSites} call sites — a call site is ` +
      'counted twice or not at all, so no number here can be trusted');
  }
  for (const gap of gaps.slice(0, 12)) console.log(`  ${gap}`);
  if (gaps.length > 12) console.log(`  … and ${gaps.length - 12} more`);
  return gaps.length ? 1 : 0;
}

// ---------------------------------------------------------------------------

const CHECKS: Check[] = [
  { name: 'compiles', proves: 'tsc --noEmit is clean — the suite reports on code that actually builds', run: compiles },
  { name: 'fixtures compile and are isolated', proves: 'a fixture is a valid input, and cannot break another language\'s gate', run: fixturesCompile },
  { name: 'schema and generated .dl agree', proves: 'the column contract in the doc is the one the engine reads', run: schemaMatchesDl },
  { name: 'frozen expectations are usable', proves: 'blessed under the pinned compiler, still about THIS corpus, non-vacuous, every site checks out', run: expectationsUsable },
  { name: 'merge-shape coverage', proves: 'which merge shapes the corpus actually exercises', run: mergeShapeCoverage },
  { name: 'resolution expectations are usable', proves: 'the flagship expectation can tell a correct parser from one that always picks the first overload', run: resolutionExpectationsUsable },
  { name: 'merge partition', proves: 'the parser\'s declarationGroupKey partition equals tsc\'s symbol partition', run: mergePartition },
  { name: 'tsc-adjudicated resolution', proves: 'every resolved call target equals getResolvedSignature', run: tscAdjudicatedResolution },
  { name: 'type-only isolation', proves: 'no type-only construct reaches the call graph', run: typeOnlyIsolation },
  { name: 'TSX reserved but empty', proves: 'reserved enum values carry no rows until TSX is switched on', run: tsxReservedButEmpty },
  { name: 'fact-base invariants', proves: 'every PK unique, every FK resolves, every tree well-formed — the failures that load cleanly and count wrong', run: factBaseInvariants },
  { name: 'IR completeness', proves: 'every hop an engine needs in order to resolve is present — the measure that replaced resolution rate', run: irCompleteness },
];

async function main(): Promise<number> {
  if (process.argv.includes('--list')) {
    for (const c of CHECKS) console.log(`${c.name}\n  ${c.proves}`);
    return 0;
  }
  console.log('='.repeat(78));
  console.log('TypeScript suite — no ts.Program, no TypeChecker, no network');
  console.log('='.repeat(78));

  if (parserPresent()) {
    const t0 = Date.now();
    try {
      await extractAllCorpora();
      console.log(`\nextraction: every corpus extracted in ${((Date.now() - t0) / 1000)
        .toFixed(1)}s, no ts.Program created`);
    } catch (e) {
      console.log(`\nextraction THREW: ${(e as Error).message}`);
      console.log('  Every parser-dependent check below will fail, which is the correct ' +
        'report: an extractor that throws must not read as a clean run.');
    }
  }

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

void main().then((code) => {
  process.exit(code);
});
