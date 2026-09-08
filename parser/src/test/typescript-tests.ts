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
import * as ts from 'typescript';
import * as path from 'path';

import { IrCompletenessReport } from '@/parsers/typescript/extractors/ts-ir-completeness';
import { verifyRelationFileStreaming } from '@/workflows/typescript/ts-relation-writer';
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

interface Check { name: string; proves: string; run: () => number | Promise<number> }
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

/**
 * tsconfig.json is JSONC, not JSON.
 *
 * `tsc` accepts comments and trailing commas, so a config carrying either builds
 * fine and then fails here on `JSON.parse` — the gate reports a broken fixture
 * when the fixture is valid. Stripping both makes this reader agree with the
 * compiler about what the file format is.
 */
function parseJsonc<T>(text: string): T {
  const withoutComments = text
    .replace(/"(?:[^"\\]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      (m) => (m.startsWith('"') ? m : ''))       // keep strings, drop comments
    .replace(/,(\s*[}\]])/g, '$1');              // trailing commas
  return JSON.parse(withoutComments) as T;
}

function readJson<T>(file: string): T | undefined {
  if (!fs.existsSync(file)) return undefined;
  return parseJsonc<T>(fs.readFileSync(file, 'utf-8'));
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
  const root = parseJsonc<{ exclude?: string[] }>(fs.readFileSync('tsconfig.json', 'utf-8'));
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
      // not one of tsc's mergeable kinds, and neither is the pattern that
      // encloses it. The mergeable set is exactly the rows that CARRY a
      // declarationGroupKey, so test that rather than a stand-in for it.
      //
      // An empty NAME used to select the same rows, back when a destructuring
      // emitted only its unnamed pattern. Now that each bound name is emitted
      // too, the proxy admits rows it never meant to -- named, unmergeable, and
      // all colliding under the empty key.
      if ((row.declarationGroupKey ?? '') !== '') {
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
    // EVERY row is exactly as wide as its header.
    //
    // joinRow asserts arity when a row is BUILT; this asserts it after the row
    // has been written and read back, which is a different failure. A relation
    // written across several append operations can be interrupted between them,
    // and the result parses as a table whose rows silently disagree in width --
    // a fact base that loads cleanly and counts wrong.
    for (const file of fs.readdirSync(outputDir)) {
      if (!file.startsWith('all-typescript-') || !file.endsWith('.csv')) {
        continue;
      }
      const text = fs.readFileSync(path.join(outputDir, file), 'utf-8');
      // Same split as the consumer -- see verifyRelationFile.
      const lines = text.split(/[\u000A\u000B\u000C\u000D\u001C\u001D\u001E\u0085\u2028\u2029]/)
        .filter((l) => l !== '');
      const head = lines[0];
      if (head === undefined) {
        continue;
      }
      const width = head.split('\t').length;
      for (let i = 1; i < lines.length; i += 1) {
        const got = lines[i]!.split('\t').length;
        if (got !== width) {
          failures.push(`${slug}: ${file} line ${i + 1} has ${got} fields, header has ` +
            `${width} — the row was torn, not merely wrong`);
          break;
        }
      }
      if (!text.endsWith('\n') && lines.length > 0) {
        failures.push(`${slug}: ${file} does not end in a newline — the write was truncated`);
      }
    }

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
      // BY NAME, not by position. This read the LAST column, which held while
      // every relation happened to end with its key -- and broke the moment a
      // column was appended after one, reporting 19,081 duplicate keys with a
      // value of "true". A convention that is only ever read positionally is
      // indistinguishable from a coincidence.
      const columns = Object.keys(relationRows[0] ?? {});
      const keyColumn = columns.find((c) => c.endsWith('UniqueHash'))
        ?? columns.slice(-1)[0] ?? '';
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
    // module initializer or a free arrow: the module owns the initializer and a
    // variable owns a free arrow, so "" is the right answer there. A row
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
  console.log('  every anonymous-shape member carries its owner FK (§4.8.1)');
  if (shapeOwnerUnfilled > 0) {
    // Asserted at 0 outright, per the retired bar's own instruction. It stood at
    // 259 while §4.8.1 was landing; every one is filled, so a ratchet here would
    // only be a number nobody reads.
    failures.push(`${shapeOwnerUnfilled} anonymous-shape member(s) have an empty owner FK. ` +
      'The slot exists (§4.8.1: c8/c7 point at ts_type_reference for a shape-owned kind), so ' +
      'the shape is reachable only through the one-way memberGroupKey hash');
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

// ---------------------------------------------------------------------------
// 10. JSX brace expressions are walked
// ---------------------------------------------------------------------------

/**
 * A call written inside a JSX brace is an ordinary call site.
 *
 * `{t(msg)}` and `label={t(msg)}` are not JSX constructs -- the braces are
 * punctuation around an ordinary expression. The walker recursed THROUGH JSX
 * from the start, which is why an arrow in `onClick={() => save()}` was always
 * walked, but nothing rooted the brace itself, so every call inside one was
 * dropped: 4,488 of a React application's 14,335 call sites, invisible because the recall
 * probe of the day measured declarations only.
 *
 * The corpus cannot carry this. Corpus A has no `.tsx` file and its
 * expectations are blessed, so the fixture is built here and thrown away.
 *
 * What must NOT appear is the component call. `<Badge/>` as `Badge({...})` is
 * JSX_COMPONENT_CALL and stays at zero until TSX is switched on -- so this
 * check asserts both directions at once: every ordinary call present, every
 * reserved value still empty.
 */
async function jsxBraceExpressionsWalked(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('JSX brace expressions are walked',
      'no extractor yet. A call inside a JSX brace is an ordinary call site; only the ' +
      'component invocation itself is reserved');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-jsx-'));
  const source = [
    'declare function t(k: string): string;',
    'declare function fmt(s: string): string;',
    'declare function save(): void;',
    'declare function rows(): string[];',
    'declare const props: Record<string, unknown>;',
    'declare class Box { constructor(v: string); }',
    'function Badge(p: { label: string }) { return <span>{p.label}</span>; }',
    'export function Panel(msg: string, flag: boolean) {',
    '  return (',
    '    <div className={fmt(msg)} onClick={() => save()} {...props}>',
    '      {t(msg)}',
    '      <Badge label={t(msg)} />',
    '      {flag ? <Badge label={fmt(msg)} /> : <span>{t("none")}</span>}',
    '      {rows().map((r) => <Badge key={r} label={fmt(r)} />)}',
    '      {new Box(t(msg)).toString()}',
    '    </div>',
    '  );',
    '}',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'panel.tsx'), source);
  // A `.tsx` with NO JSX in it. `scriptKind` cannot tell this apart from
  // `panel.tsx` because it only reports the EXTENSION, so this is the control
  // that makes `hasJsxContent` mean CONTENT.
  fs.writeFileSync(path.join(root, 'plain.tsx'), 'export const plain = 1;\n');
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { jsx: 'react-jsx', target: 'ES2022', module: 'ESNext', strict: true },
    include: ['*.tsx'],
  }));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-jsx-out-'));
  await new TypeScriptProjectAnalyzer().analyze({
    rootDir: root, outputDir, baseMservPath: root, serviceVersionLink: 'jsx-check',
  });

  const modules = relation(outputDir, 'all-typescript-modules.csv');
  const modulePath = new Map(modules
    .map((m) => [m.tsModuleUniqueHash ?? '', m.filePath ?? '']));
  const emitted = new Set(relation(outputDir, 'all-typescript-call-sites.csv')
    .map((r) => `${modulePath.get(r.tsModuleLinkHash ?? '') ?? '?'}:${r.startLine}:${r.startColumn}`));

  const sf = ts.createSourceFile(path.join(root, 'panel.tsx'), source,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const failures: string[] = [];
  // Counted apart from `failures`, because the summary below reports how many
  // CALLS were emitted -- deriving it from the failure total made an unrelated
  // assertion read as a missing call site.
  let missingCalls = 0;

  // `hasJsxContent` was hardcoded `false`, so it could never be true, while
  // §4.1 says it and `scriptKind` "already carry the file-level facts". Both
  // files are TSX; only one holds JSX.
  for (const [file, want] of [['panel.tsx', 'true'], ['plain.tsx', 'false']] as const) {
    const row = modules.find((m) => (m.filePath ?? '').endsWith(file));
    if (row === undefined) {
      failures.push(`no ts_module row for ${file}`);
      continue;
    }
    if (row.scriptKind !== 'TSX') {
      failures.push(`${file}: scriptKind is ${row.scriptKind}, expected TSX`);
    }
    if (row.hasJsxContent !== want) {
      failures.push(`${file}: hasJsxContent is ${row.hasJsxContent}, expected ${want} — the `
        + 'column must report JSX CONTENT, which scriptKind cannot');
    }
  }
  let expected = 0;
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      expected += 1;
      const p = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const key = `panel.tsx:${p.line + 1}:${p.character + 1}`;
      if (!emitted.has(key)) {
        missingCalls += 1;
        failures.push(`no ts_call_site at ${key} for \`${node.getText(sf).slice(0, 44)}\``);
      }
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sf, walk);

  // The other direction: the component invocation must still be absent.
  for (const [file, names] of [
    ['all-typescript-call-sites.csv', ['callKind']],
    ['all-typescript-expressions.csv', ['kind', 'edgeRole']],
  ] as [string, string[]][]) {
    for (const row of relation(outputDir, file)) {
      for (const name of names) {
        if (RESERVED_TSX_VALUES.has(row[name] ?? '')) {
          failures.push(`${file} carries reserved ${name}=${row[name]} — the component call ` +
            'must stay empty while only the braces are walked');
        }
      }
    }
  }

  console.log(`  ${expected} call/new node(s) in JSX attributes, children, spreads and a ` +
    `nested map; ${expected - missingCalls} emitted, ${RESERVED_TSX_VALUES.size} reserved ` +
    'value(s) still empty');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 14. Destructuring records what each name binds
// ---------------------------------------------------------------------------

/**
 * A destructured name says WHERE it came from, not just what it is called.
 *
 * `const { b: renamed } = o` and `const [renamed] = xs` produce the same name
 * from completely different sources, and for a long while the fact base carried
 * neither -- the bound names were not emitted at all, and once they were, they
 * arrived without their origin. Shorthand `{ a }` hides both bugs, because
 * there the name and the property coincide, which is exactly why this needs a
 * fixture that is not shorthand.
 *
 * Built here and thrown away: Corpus A's expectations are blessed, and every
 * form below would have to be added to them to test the same thing.
 */
async function destructuringRecordsItsSource(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('destructuring records its source',
      'no extractor yet. A bound name must carry the property or index it binds');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-bind-'));
  const source = [
    'export function shapes(o: { a: number; b: number; c: number }, xs: number[]) {',
    '  const { a } = o;',
    '  const { b: renamed } = o;',
    '  const { a: p, ...others } = o;',
    '  const [first, second] = xs;',
    '  const [, skipped] = xs;',
    '  const [head, ...tail] = xs;',
    '  const key = "c";',
    '  const { [key]: computed } = o;',
    '  const plain = 1;',
    '  return [a, renamed, p, others, first, second, skipped, head, tail, computed, plain];',
    '}',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'bind.ts'), source);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
    include: ['*.ts'],
  }));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-bind-out-'));
  await new TypeScriptProjectAnalyzer().analyze({
    rootDir: root, outputDir, baseMservPath: root, serviceVersionLink: 'bind-check',
  });

  const byName = new Map<string, Record<string, string>>();
  for (const row of relation(outputDir, 'all-typescript-variables.csv')) {
    if ((row.name ?? '') !== '') {
      byName.set(row.name!, row);
    }
  }

  // name -> [bindingSourceKind, bindingSource]
  const expected: [string, string, string][] = [
    ['a', 'PROPERTY', 'a'],            // shorthand: name and property coincide
    ['renamed', 'PROPERTY', 'b'],      // the case the engine could not recover
    ['p', 'PROPERTY', 'a'],
    ['others', 'OBJECT_REST', ''],
    ['first', 'INDEX', '0'],
    ['second', 'INDEX', '1'],
    ['skipped', 'INDEX', '1'],         // the hole ahead of it still counts
    ['head', 'INDEX', '0'],
    ['tail', 'ARRAY_REST', '1'],
    ['computed', 'PROPERTY', '[key]'], // text, never a guess
    ['plain', 'NONE', ''],             // an ordinary declaration binds nothing
  ];

  const failures: string[] = [];
  for (const [name, kind, src] of expected) {
    const row = byName.get(name);
    if (!row) {
      failures.push(`no ts_variable row named ${name} — the bound name was not emitted`);
      continue;
    }
    const gotKind = row.bindingSourceKind ?? '';
    const gotSource = row.bindingSource ?? '';
    if (gotKind !== kind || gotSource !== src) {
      failures.push(`${name}: expected ${kind}/"${src}", got ${gotKind}/"${gotSource}"`);
    }
  }
  // Nothing that is not a destructuring may claim a source.
  for (const row of relation(outputDir, 'all-typescript-variables.csv')) {
    if (row.isDestructuring !== 'true' && (row.bindingSourceKind ?? '') !== 'NONE') {
      failures.push(`${row.name}: not a destructuring but carries ` +
        `bindingSourceKind=${row.bindingSourceKind}`);
    }
  }

  console.log(`  ${expected.length} binding form(s) checked: shorthand, renamed, object rest, ` +
    'positional, hole, array rest, computed key, and an ordinary declaration');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 15. No emitted value can split a row for any reader
// ---------------------------------------------------------------------------

/**
 * A value must not contain anything a CONSUMER treats as a line break.
 *
 * `split('\n')` and Python's `str.splitlines()` disagree: the latter also
 * breaks on U+000B, U+000C, U+001C-U+001E, U+0085, U+2028 and U+2029. A string
 * literal carrying one of those -- legal JavaScript, and real in published
 * bundles -- produced a file that was well formed to the parser and torn to the
 * reader. It surfaced as `11 field(s) where the header has 34` on a LITERAL row,
 * and nothing on our side could see it, because every check split the JS way.
 *
 * This asserts the property directly rather than the symptom: no raw break
 * character survives into any relation, and every row is the header's width
 * under the READER's definition of a line.
 */
async function noValueCanSplitARow(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('no emitted value can split a row',
      'no extractor yet. A value must not contain anything a consumer treats as a line break');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-break-'));
  // Each literal carries one break character that split('\n') does NOT see.
  const breaks = ['\u000B', '\u000C', '\u001C', '\u001D', '\u001E', '\u0085', '\u2028', '\u2029'];
  const lines = ['export const values = ['];
  breaks.forEach((c, i) => { lines.push(`  " pkg${c}runtime ${i}",`); });
  lines.push('];');
  lines.push('export const tabbed = "a\\tb";');
  fs.writeFileSync(path.join(root, 'breaks.ts'), lines.join('\n'));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext' }, include: ['*.ts'],
  }));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-break-out-'));
  await new TypeScriptProjectAnalyzer().analyze({
    rootDir: root, outputDir, baseMservPath: root, serviceVersionLink: 'break-check',
  });

  const READER_BREAKS = /[\u000A\u000B\u000C\u000D\u001C\u001D\u001E\u0085\u2028\u2029]/;
  const RAW_IN_VALUE = /[\u000B\u000C\u001C\u001D\u001E\u0085\u2028\u2029]/;
  const failures: string[] = [];
  let checked = 0;
  for (const file of fs.readdirSync(outputDir)) {
    if (!file.startsWith('all-typescript-') || !file.endsWith('.csv')) {
      continue;
    }
    const text = fs.readFileSync(path.join(outputDir, file), 'utf-8');
    if (RAW_IN_VALUE.test(text)) {
      failures.push(`${file} contains a raw break character — a reader will split the row there`);
    }
    const rows = text.split(READER_BREAKS).filter((l) => l !== '');
    const head = rows[0];
    if (head === undefined) {
      continue;
    }
    const width = head.split('\t').length;
    for (let i = 1; i < rows.length; i += 1) {
      checked += 1;
      const got = rows[i]!.split('\t').length;
      if (got !== width) {
        failures.push(`${file} row ${i + 1}: ${got} field(s) where the header has ${width}`);
        break;
      }
    }
  }

  console.log(`  ${breaks.length} break character(s) embedded in string literals; ${checked} row(s) ` +
    "checked under the reader's definition of a line, not JavaScript's");
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 16. Every signature links the return reference it declares
// ---------------------------------------------------------------------------

/**
 * A signature that declares a return type must NAME the reference for it.
 *
 * A signature declared inside a type does not create its own return reference:
 * the enclosing type's tree emits it, at depth 1. So the five type-level kinds
 * had a correct reference sitting in the fact base and no way to reach it --
 * 8,528 rows, none linked -- while FUNCTION_DECLARATION and the class kinds
 * were fine, which is what made it look like a niche gap rather than every
 * callable shape in the language.
 *
 * The consequence was not a missing row but a dead end: a call through a
 * callable shape resolved to its exact target and then produced no result type,
 * so every chain through one stopped there.
 *
 * The type-ARGUMENT case is in the fixture on purpose. `vi.fn<(x: string) =>
 * string>(…)` has its reference emitted by the EXPRESSION pass, so a link
 * performed at the end of the declaration walk finds nothing for exactly those
 * rows -- 210 of 990 on one library -- and the ordering is invisible unless a fixture
 * forces it.
 */
async function signaturesLinkTheirReturnType(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('signatures link their return type',
      'no extractor yet. A signature that declares a return type must name its reference');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ret-'));
  const source = [
    'export type Cond<A> = { ok: A };',
    'declare function generic<T>(x: unknown): T;',
    'export type CallSig = { <A>(actual: A): Cond<A> };',          // TYPE_LITERAL_CALL_SIGNATURE
    'export type FnType = (x: number) => Cond<number>;',            // FUNCTION_TYPE_SIGNATURE
    'export type CtorType = new (x: number) => Cond<number>;',      // CONSTRUCTOR_TYPE_SIGNATURE
    'export type Lit = { m(x: string): Cond<string> };',            // TYPE_LITERAL_METHOD_SIGNATURE
    'export type Ctor = { new (y: number): Cond<number> };',        // TYPE_LITERAL_CONSTRUCT_SIGNATURE
    'export type Prim = (x: number) => void;',                      // a primitive return still links
    'export const viaTypeArgument = generic<(x: string) => string>(1);',
    'export interface I { sig(x: string): Cond<string> }',
    'export function decl(x: string): Cond<string> { return { ok: x }; }',
    'export class C { m(): Cond<number> { return { ok: 1 }; } }',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'ret.ts'), source);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true }, include: ['*.ts'],
  }));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ret-out-'));
  await new TypeScriptProjectAnalyzer().analyze({
    rootDir: root, outputDir, baseMservPath: root, serviceVersionLink: 'ret-check',
  });

  const references = new Map(relation(outputDir, 'all-typescript-type-references.csv')
    .map((r) => [r.tsTypeReferenceUniqueHash ?? '', r]));
  const failures: string[] = [];
  const seen = new Set<string>();
  let linked = 0;
  for (const row of relation(outputDir, 'all-typescript-methods.csv')) {
    if ((row.returnTypeName ?? '') === '' || row.name === '<module>') {
      continue;
    }
    seen.add(row.methodKind ?? '');
    const hash = row.returnTypeReferenceLinkHash ?? '';
    if (hash === '') {
      failures.push(`${row.methodKind} returning ${row.returnTypeName} has no ` +
        'returnTypeReferenceLinkHash — the reference exists but nothing names it');
      continue;
    }
    const reference = references.get(hash);
    if (!reference) {
      failures.push(`${row.methodKind}: returnTypeReferenceLinkHash is DANGLING`);
    } else if (reference.context !== 'METHOD_RETURN') {
      failures.push(`${row.methodKind}: links a reference whose context is ` +
        `${reference.context}, not METHOD_RETURN`);
    } else {
      linked += 1;
    }
  }

  // The five type-level kinds are the ones that were broken; assert the fixture
  // actually produced them, so this cannot pass by not exercising them.
  for (const kind of ['FUNCTION_TYPE_SIGNATURE', 'CONSTRUCTOR_TYPE_SIGNATURE',
    'TYPE_LITERAL_CALL_SIGNATURE', 'TYPE_LITERAL_METHOD_SIGNATURE',
    'TYPE_LITERAL_CONSTRUCT_SIGNATURE']) {
    if (!seen.has(kind)) {
      failures.push(`the fixture produced no ${kind} row — the check is vacuous for it`);
    }
  }

  console.log(`  ${linked} signature(s) link a METHOD_RETURN reference across ` +
    `${seen.size} method kind(s), including a function type used as a type argument`);
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
  return failures.length ? 1 : 0;
}

/** Runs the analyzer over an inline fixture and returns its output directory. */
async function analyseInline(
  prefix: string,
  files: Record<string, string>,
  compilerOptions: Record<string, unknown> = {}
): Promise<{ outputDir: string; cleanup: () => void }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  if (files['tsconfig.json'] === undefined) {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true, ...compilerOptions },
      include: ['**/*.ts', '**/*.tsx'],
    }));
  }
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}out-`));
  await new TypeScriptProjectAnalyzer().analyze({
    rootDir: root, outputDir, baseMservPath: root, serviceVersionLink: 'regression',
  });
  return {
    outputDir,
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outputDir, { recursive: true, force: true });
    },
  };
}

/**
 * Like `analyseInline`, but drives every PROGRAM under the root as the entry
 * point does. Writes its own tsconfig files, so none is generated.
 */
async function analyseProgramsInline(
  prefix: string,
  files: Record<string, string>
): Promise<{ outputDir: string; cleanup: () => void }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}out-`));
  await new TypeScriptProjectAnalyzer().analyzePrograms({
    rootDir: root, outputDir, baseMservPath: root, serviceVersionLink: 'regression',
  });
  return {
    outputDir,
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outputDir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// 17. Kinds that were wrong once
// ---------------------------------------------------------------------------

/**
 * Every enum value below was emitted incorrectly at some point, and none of the
 * failures lost a row -- a correctly-positioned row with the WRONG KIND passes
 * recall, completeness and compiler adjudication alike, so nothing else here
 * can see it.
 *
 *   declarationKind   every `const` read AWAIT_USING, because NodeFlags.
 *                     AwaitUsing is the COMPOSITE Const|Using and the test was
 *                     a truthiness one. CONST was emitted zero times.
 *   DECORATOR_CALL    `@Get("/x")` read FUNCTION_CALL, losing the fact that a
 *                     decorator runs at class-definition time.
 *   LABELED           a labelled loop emitted the loop and dropped the label.
 *   NAMESPACE_BODY    namespace and ambient-module bodies emitted no block row.
 *   MODULE_BODY       at all, on two separate code paths.
 *   TYPE_IMPORT_NODE  `import("m").T` emitted no module edge, leaving the
 *                     specifier as text inside a type name.
 */
async function kindsThatWereWrongOnce(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('kinds that were wrong once',
      'no extractor yet. Asserts the enum values that have been emitted incorrectly before');
  }
  const { outputDir, cleanup } = await analyseInline('ts-kinds-', {
    'k.ts': [
      'declare function Injectable(): ClassDecorator;',
      'export type Q = typeof import("./other")["thing"];',
      'export namespace NS { export const inside = 1; }',
      '@Injectable()',
      'export class C {',
      '  m(xs: number[]) {',
      '    const c = 1;',
      '    let l = 2;',
      '    var v = 3;',
      '    outer: for (const x of xs) { if (x) { break outer; } }',
      '    for (const k in { a: 1 }) { void k; }',
      '    try { void 0; } catch (e) { void e; }',
      '    return [c, l, v];',
      '  }',
      '}',
    ].join('\n'),
    'other.ts': 'export const thing = 1;\n',
    'ambient.d.ts': 'declare module "legacy-pkg" { export function go(): void; }\n',
  }, { experimentalDecorators: true });

  const failures: string[] = [];
  const has = (file: string, column: string, value: string): boolean =>
    relation(outputDir, file).some((r) => (r[column] ?? '') === value);
  const expectations: [string, string, string, string][] = [
    ['all-typescript-variables.csv', 'declarationKind', 'CONST', 'const must not read AWAIT_USING'],
    ['all-typescript-variables.csv', 'declarationKind', 'LET', 'let'],
    ['all-typescript-variables.csv', 'declarationKind', 'VAR', 'var'],
    ['all-typescript-variables.csv', 'declarationKind', 'FOR_OF', 'for-of binding'],
    ['all-typescript-variables.csv', 'declarationKind', 'FOR_IN', 'for-in binding'],
    ['all-typescript-variables.csv', 'declarationKind', 'CATCH', 'catch binding'],
    ['all-typescript-call-sites.csv', 'callKind', 'DECORATOR_CALL', 'a decorator runs; it is not a plain function call'],
    ['all-typescript-blocks.csv', 'blockKind', 'LABELED', 'a labelled statement keeps its label'],
    ['all-typescript-blocks.csv', 'blockKind', 'NAMESPACE_BODY', 'a namespace body is a block'],
    ['all-typescript-blocks.csv', 'blockKind', 'MODULE_BODY', 'an ambient module body is a block'],
    ['all-typescript-imports.csv', 'importKind', 'TYPE_IMPORT_NODE', 'import() in a type position is a module edge'],
  ];
  for (const [file, column, value, why] of expectations) {
    if (!has(file, column, value)) {
      failures.push(`${file}: no row with ${column}=${value} — ${why}`);
    }
  }
  // AWAIT_USING must appear only for the construct that is actually one.
  for (const row of relation(outputDir, 'all-typescript-variables.csv')) {
    if (row.declarationKind === 'AWAIT_USING') {
      failures.push(`${row.name}: read AWAIT_USING, but the fixture declares no \`await using\``);
    }
  }

  console.log(`  ${expectations.length} enum value(s) asserted across variables, call sites, ` +
    'blocks and imports — each one emitted wrongly at some point');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  cleanup();
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 18. Overload resolution never names the implementation
// ---------------------------------------------------------------------------

/**
 * §4.6: the IMPLEMENTATION "is NOT the signature a call resolves to".
 *
 * Its parameter list is the UNION of the overloads it serves, so it admits
 * every arity they do. Counting it as a candidate made an unambiguous set look
 * ambiguous and the column was left empty -- a silent loss, because an empty
 * column is indistinguishable from "syntax cannot decide".
 *
 * The second half is the shape member: `{ resolve(); resolve(v) }` had every
 * signature marked SOLE -- "the only declaration of its name in its table" --
 * which is false whenever there are two, and makes a consumer fan across them.
 */
async function overloadsNeverNameTheImplementation(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('overloads never name the implementation',
      'no extractor yet. A call resolves to an overload signature, never to the implementation');
  }
  const { outputDir, cleanup } = await analyseInline('ts-ovl-', {
    'o.ts': [
      'export function pick(a: string): string;',
      'export function pick(a: string, b: number): number;',
      'export function pick(a: string, b?: number): string | number { return b ?? a; }',
      'export declare const shape: { resolve(): void; resolve(v: number): void };',
      'export declare const single: { only(): void };',
      'export function run() { return pick("x"); }',
    ].join('\n'),
  });

  const failures: string[] = [];
  const methods = relation(outputDir, 'all-typescript-methods.csv');
  const byHash = new Map(methods.map((m) => [m.tsMethodUniqueHash ?? '', m]));

  const call = relation(outputDir, 'all-typescript-call-sites.csv')
    .find((c) => c.calleeName === 'pick');
  if (!call) {
    failures.push('no call site for pick("x")');
  } else {
    const target = byHash.get(call.resolvedSignatureLinkHash ?? '');
    if (!target) {
      failures.push('pick("x") resolved to nothing — one signature accepts one argument, so ' +
        'arity decides it; the implementation is not a candidate');
    } else if (target.signatureRole === 'IMPLEMENTATION') {
      failures.push('pick("x") resolved to the IMPLEMENTATION, which is never what tsc names');
    }
  }

  const resolves = methods.filter((m) => m.name === 'resolve');
  if (resolves.length !== 2) {
    failures.push(`expected 2 shape signatures named resolve, found ${resolves.length}`);
  }
  for (const row of resolves) {
    if (row.signatureRole === 'SOLE') {
      failures.push('a shape member with two signatures claims SOLE — "the only declaration of ' +
        'its name in its table" is false when there are two');
    }
  }
  const only = methods.find((m) => m.name === 'only');
  if (only && only.signatureRole !== 'SOLE') {
    failures.push(`a lone shape member should stay SOLE, got ${only.signatureRole}`);
  }

  console.log(`  arity picks the signature over the implementation; ${resolves.length} shape ` +
    'signatures of one name are not SOLE, and a lone one still is');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  cleanup();
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 19. Discovery follows the import closure
// ---------------------------------------------------------------------------

/**
 * `"files": [...]` names ENTRY POINTS, not a file list.
 *
 * tsc follows imports transitively. Reading the config literally gave one library 4
 * files where the real program has 17, so 13 files and 61% of its call sites
 * were invisible -- and nothing reported it, because a file that no config
 * claims is not an error, it simply never arrives.
 */
async function discoveryFollowsTheImportClosure(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('discovery follows the import closure',
      'no extractor yet. A program is its roots plus everything they import');
  }
  const { outputDir, cleanup } = await analyseInline('ts-closure-', {
    // Only entry.ts is named. helper.ts and deep.ts arrive only by being imported.
    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
      files: ['./entry.ts'],
    }),
    'entry.ts': 'import { helper } from "./helper";\nexport const a = helper();\n',
    'helper.ts': 'import { deep } from "./deep";\nexport function helper() { return deep(); }\n',
    'deep.ts': 'export function deep() { return 1; }\n',
    'unreachable.ts': 'export function never() { return 0; }\n',
  });

  const analysed = new Set(relation(outputDir, 'all-typescript-modules.csv')
    .map((m) => m.filePath ?? ''));
  const failures: string[] = [];
  for (const expected of ['entry.ts', 'helper.ts', 'deep.ts']) {
    if (!analysed.has(expected)) {
      failures.push(`${expected} was not analysed — "files" names entry points, and tsc follows ` +
        'imports transitively from them');
    }
  }
  // The closure must not become "walk everything": a file nothing imports and
  // no config claims still belongs to no program.
  if (analysed.has('unreachable.ts')) {
    failures.push('unreachable.ts was analysed — it is imported by nothing and named by nothing, ' +
      'so the closure has become a directory walk');
  }

  console.log(`  ${analysed.size} module(s) from one named entry point: the closure reaches ` +
    'transitively imported files and stops at unreachable ones');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  cleanup();
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 20. A pattern parameter emits the names it binds
// ---------------------------------------------------------------------------

/**
 * `function f({ helper }: Ctx)` declares `helper`.
 *
 * Only the pattern was emitted, with an empty name, so the binding existed
 * nowhere -- and unlike the variable case there was nothing to fall back on: a
 * consumer cannot resolve a name that was never recorded, so every call through
 * one was unresolvable with no partial answer available.
 *
 * The pattern row is KEPT. It is the parameter -- it holds the argument
 * position and the annotation the bound names are read out of -- so the bound
 * names are additional rows, not replacements, and they share its position
 * because they are the same argument.
 */
async function patternParametersBindNames(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('pattern parameters bind names',
      'no extractor yet. A destructured parameter must emit the names it binds');
  }
  const { outputDir, cleanup } = await analyseInline('ts-param-', {
    'p.ts': [
      'export interface Ctx { helper(name: string): string; nested: { deep(n: number): number } }',
      'export function obj({ helper, nested }: Ctx): string { nested.deep(1); return helper("x"); }',
      'export function renamed({ helper: h }: Ctx): string { return h("y"); }',
      'export function rest({ helper, ...others }: Ctx): unknown { void others; return helper("z"); }',
      'export function arr([first, second]: number[]): number { return first + second; }',
      'export function arrRest([head, ...tail]: number[]): unknown { void tail; return head; }',
      'export function plain(c: Ctx): string { return c.helper("w"); }',
    ].join('\n'),
  });

  const methods = new Map(relation(outputDir, 'all-typescript-methods.csv')
    .map((m) => [m.tsMethodUniqueHash ?? '', m.name ?? '']));
  const byOwnerAndName = new Map<string, Record<string, string>>();
  for (const row of relation(outputDir, 'all-typescript-method-parameters.csv')) {
    byOwnerAndName.set(`${methods.get(row.tsMethodLinkHash ?? '')}|${row.paramName}`, row);
  }

  // owner|name -> [bindingSourceKind, bindingSource]
  const expected: [string, string, string][] = [
    ['obj|helper', 'PROPERTY', 'helper'],
    ['obj|nested', 'PROPERTY', 'nested'],
    ['renamed|h', 'PROPERTY', 'helper'],       // the name differs from the property
    ['rest|helper', 'PROPERTY', 'helper'],
    ['rest|others', 'OBJECT_REST', ''],
    ['arr|first', 'INDEX', '0'],
    ['arr|second', 'INDEX', '1'],
    ['arrRest|head', 'INDEX', '0'],
    ['arrRest|tail', 'ARRAY_REST', '1'],
    ['plain|c', 'NONE', ''],                    // an ordinary parameter binds nothing
  ];
  const failures: string[] = [];
  for (const [key, kind, source] of expected) {
    const row = byOwnerAndName.get(key);
    if (!row) {
      failures.push(`no parameter row for ${key} — the bound name was not emitted`);
      continue;
    }
    if ((row.bindingSourceKind ?? '') !== kind || (row.bindingSource ?? '') !== source) {
      failures.push(`${key}: expected ${kind}/"${source}", got ` +
        `${row.bindingSourceKind}/"${row.bindingSource}"`);
    }
  }
  // The pattern row survives, and still carries the position and the annotation.
  const pattern = relation(outputDir, 'all-typescript-method-parameters.csv')
    .find((r) => methods.get(r.tsMethodLinkHash ?? '') === 'obj' && r.paramName === '');
  if (!pattern) {
    failures.push('the pattern row itself was dropped — it is the parameter, and it carries the ' +
      'argument position and the annotation the bound names are read out of');
  } else if ((pattern.parameterTypeName ?? '') !== 'Ctx') {
    failures.push(`the pattern row lost its annotation: ${pattern.parameterTypeName}`);
  }
  // A bound name shares the pattern's argument position; it has none of its own.
  const boundHelper = byOwnerAndName.get('obj|helper');
  if (boundHelper && pattern && boundHelper.position !== pattern.position) {
    failures.push(`a bound name reports position ${boundHelper.position} where the pattern is at ` +
      `${pattern.position} — they are the same argument`);
  }

  console.log(`  ${expected.length} binding form(s) on parameters: shorthand, renamed, object ` +
    'rest, positional, array rest, and an ordinary parameter; the pattern row survives');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  cleanup();
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 21. A destructured name reaches the value it came from
// ---------------------------------------------------------------------------

/**
 * `const { helper } = createContext()` reads `helper` out of what the call
 * returned.
 *
 * The bound name carried the property it binds and the pattern row carried the
 * initializer, and the two shared no key -- `declarationGroupKey` is empty on
 * both, deliberately, because neither is a mergeable declaration. So a bound
 * name was a declaration with a property name and nothing to apply it to, and
 * every call through one was unresolvable.
 *
 * The parameter form has never had this problem: a bound name shares the
 * pattern's `position` within the same method, which is an exact join. Variables
 * have no equivalent, so the initializer is copied onto each bound name
 * instead.
 *
 * A NESTED leaf gets the ROOT initializer, and that is the right answer rather
 * than an approximation: `const { a: { b } } = ctx()` means b comes out of
 * ctx() by way of `a`, and the intermediate pattern has no name to key on.
 */
async function destructuredNamesReachTheirValue(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('destructured names reach their value',
      'no extractor yet. A bound name must link the initializer it was destructured from');
  }
  const { outputDir, cleanup } = await analyseInline('ts-init-', {
    'v.ts': [
      'export interface Ctx { helper(n: string): string; nested: { deep(n: number): number } }',
      'declare function createContext(): Ctx;',
      'export function inBody(): string {',
      '  const { helper: h2, nested: n2 } = createContext();',
      '  n2.deep(2);',
      '  return h2("y");',
      '}',
      'export function nestedPattern(c: { a: { b: (x: number) => number } }) {',
      '  const { a: { b } } = c;',
      '  return b(1);',
      '}',
      'export function positional(xs: (() => number)[]) {',
      '  const [first] = xs;',
      '  return first();',
      '}',
      'export function noInitializer(o: { z: number }) {',
      '  let z: number;',
      '  ({ z } = o);',
      '  return z;',
      '}',
      'export function iterating(pairs: [string, number][]) {',
      '  for (const [key, value] of pairs) { void key; void value; }',
      '}',
    ].join('\n'),
  });

  const expressions = new Map(relation(outputDir, 'all-typescript-expressions.csv')
    .map((e) => [e.tsExpressionUniqueHash ?? '', e]));
  const variables = relation(outputDir, 'all-typescript-variables.csv');
  const byName = new Map(variables.filter((v) => v.name !== '').map((v) => [v.name!, v]));

  const failures: string[] = [];
  // name -> the expression kind its initializer must be
  const expected: [string, string][] = [
    ['h2', 'CALL_EXPRESSION'],        // out of createContext()
    ['n2', 'CALL_EXPRESSION'],
    ['b', 'IDENTIFIER_REFERENCE'],    // a nested leaf gets the ROOT initializer
    ['first', 'IDENTIFIER_REFERENCE'],
  ];
  for (const [name, kind] of expected) {
    const row = byName.get(name);
    if (!row) {
      failures.push(`no variable row named ${name}`);
      continue;
    }
    const hash = row.initializerExpressionLinkHash ?? '';
    if (hash === '') {
      failures.push(`${name}: no initializerExpressionLinkHash — it knows which property it ` +
        'binds and not what it binds it out of, so a call through it cannot resolve');
      continue;
    }
    const initializer = expressions.get(hash);
    if (!initializer) {
      failures.push(`${name}: initializerExpressionLinkHash is DANGLING`);
    } else if (initializer.kind !== kind) {
      failures.push(`${name}: links a ${initializer.kind}, expected ${kind}`);
    }
  }
  // The bound name and its pattern must name the SAME value, not merely both
  // have one -- that is what makes the join exact.
  const pattern = variables.find((v) => v.name === '' && v.isDestructuring === 'true');
  const h2 = byName.get('h2');
  if (pattern && h2 && pattern.initializerExpressionLinkHash !== h2.initializerExpressionLinkHash) {
    failures.push('a bound name links a DIFFERENT initializer from its pattern; they are the ' +
      'same value and must be the same row');
  }
  // A destructuring assignment has no initializer, and must not invent one.
  const z = byName.get('z');
  if (z && (z.initializerExpressionLinkHash ?? '') !== '') {
    failures.push('`let z` with no initializer reports one');
  }
  // A for-of binding has no initializer either -- the iterable belongs to the
  // for-of STATEMENT, not to the declaration. Asserted so the empty column
  // there is a recorded expectation rather than something that looks like this
  // fix having missed a case: on one library it is 60 of 152 bound names, and
  // every one of them is correct.
  for (const name of ['key', 'value']) {
    const row = byName.get(name);
    if (!row) {
      failures.push(`no variable row named ${name}`);
    } else if (row.declarationKind !== 'FOR_OF') {
      failures.push(`${name}: expected FOR_OF, got ${row.declarationKind}`);
    } else if ((row.initializerExpressionLinkHash ?? '') !== '') {
      failures.push(`${name}: a for-of binding reports an initializer, but the iterable belongs ` +
        'to the statement and the declaration has none');
    }
  }

  console.log(`  ${expected.length} bound name(s) reach their initializer, nested and positional ` +
    'included; a for-of binding correctly reports none, and a bound name names the same ' +
    'expression row as its pattern');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  cleanup();
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 22. An unresolved import still names its package
// ---------------------------------------------------------------------------

/**
 * A client-only run must be able to say WHAT to stage.
 *
 * `packageName` normally comes from the resolved module's packageId, which
 * exists only when node_modules was present. So on a run without dependencies
 * -- which is the ordinary case for a client-only analysis -- it was empty on
 * every unresolved import, and a consumer had to re-derive it from the
 * specifier to answer "which package would close these hops". On one library
 * that is 992 imports, and two packages account for 977 of them.
 *
 * The name is pure syntax, so it is available whether resolution succeeded or
 * not. The scoped form is the part worth testing: `@scope/name/deep` is the
 * package `@scope/name`, and taking one segment gives `@scope`, which is not a
 * package and would send a caller looking for something that does not exist.
 */
async function unresolvedImportsNameTheirPackage(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('unresolved imports name their package',
      'no extractor yet. An unresolved import must still say which package it names');
  }
  const { outputDir, cleanup } = await analyseInline('ts-pkg-', {
    'p.ts': [
      'import a from "absent-package";',
      'import b from "absent-package/deep/path";',
      'import c from "@scope/absent";',
      'import d from "@scope/absent/deep";',
      'import e from "node:fs/promises";',
      'import f from "path";',
      'import g from "./local";',
      'export const used = [a, b, c, d, e, f, g];',
    ].join('\n'),
    'local.ts': 'export default 1;\n',
  });

  const byPath = new Map(relation(outputDir, 'all-typescript-imports.csv')
    .map((r) => [r.importedPath ?? '', r]));
  // specifier -> [resolutionKind, packageName]
  const expected: [string, string, string][] = [
    ['absent-package', 'UNRESOLVED', 'absent-package'],
    ['absent-package/deep/path', 'UNRESOLVED', 'absent-package'],
    ['@scope/absent', 'UNRESOLVED', '@scope/absent'],
    // the scoped case: two segments, not one
    ['@scope/absent/deep', 'UNRESOLVED', '@scope/absent'],
    // a builtin is not a package to stage, and must not claim to be one
    ['node:fs/promises', 'BUILTIN_NODE', ''],
    ['path', 'BUILTIN_NODE', ''],
    // a relative import names no package
    ['./local', 'RELATIVE_FILE', ''],
  ];
  const failures: string[] = [];
  for (const [specifier, kind, pkg] of expected) {
    const row = byPath.get(specifier);
    if (!row) {
      failures.push(`no ts_import row for ${specifier}`);
      continue;
    }
    if ((row.resolutionKind ?? '') !== kind) {
      failures.push(`${specifier}: resolutionKind ${row.resolutionKind}, expected ${kind}`);
    }
    if ((row.packageName ?? '') !== pkg) {
      failures.push(`${specifier}: packageName "${row.packageName}", expected "${pkg}"`);
    }
  }

  console.log(`  ${expected.length} specifier(s): a bare and a deep import name their package, a ` +
    'scoped one names both segments, and builtins and relatives name none');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  cleanup();
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 23. Every annotated declaration names its type
// ---------------------------------------------------------------------------

/**
 * A declared type must be reachable as a ROW, not only readable as text.
 *
 * `fieldTypeName` is the source text. Following it anywhere -- to the interface
 * it names, to the element type inside `Record<string, X>` -- needs the
 * `ts_type_reference` tree, and that is reached through
 * `typeReferenceLinkHash`. Without it a consumer has to parse the annotation
 * out of a string, which is the one thing a fact base exists to avoid.
 *
 * Two kinds had it empty for different reasons, and both are the same mistake
 * seen twice: a member of an anonymous shape does not create its own reference,
 * because the enclosing type's tree emits it; and a parameter property's field
 * could only be typed by hopping through the parameter that declared it. On one
 * library that was 2,406 of 2,441 annotated fields carrying text and nothing
 * else.
 */
async function annotatedDeclarationsNameTheirType(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('annotated declarations name their type',
      'no extractor yet. An annotated declaration must link its type reference');
  }
  const { outputDir, cleanup } = await analyseInline('ts-typelink-', {
    't.ts': [
      'export interface Dep { run(): void }',
      'export class C {',
      '  field: Dep;',
      '  readonly ro: Dep[] = [];',
      '  constructor(private injected: Dep, public other: Dep) { this.field = injected; }',
      '}',
      'export interface I { member: Dep }',
      'export type L = { lit: Dep; nested: { inner: Dep } };',
      'export type Indexed = { [k: string]: Dep };',
      'export function fn(p: Dep, q?: Dep) { return [p, q]; }',
      'export function ret(): Dep { return null as never; }',
    ].join('\n'),
  });

  const references = new Map(relation(outputDir, 'all-typescript-type-references.csv')
    .map((r) => [r.tsTypeReferenceUniqueHash ?? '', r]));
  const failures: string[] = [];
  const kinds = new Set<string>();
  let linked = 0;

  for (const row of relation(outputDir, 'all-typescript-fields.csv')) {
    if ((row.fieldTypeName ?? '') === '') {
      continue;
    }
    kinds.add(row.memberKind ?? '');
    const hash = row.typeReferenceLinkHash ?? '';
    if (hash === '') {
      failures.push(`${row.memberKind} ${row.name}: annotated "${row.fieldTypeName}" but no ` +
        'typeReferenceLinkHash — the type is text only');
    } else if (!references.has(hash)) {
      failures.push(`${row.memberKind} ${row.name}: typeReferenceLinkHash is DANGLING`);
    } else {
      linked += 1;
    }
  }
  for (const row of relation(outputDir, 'all-typescript-method-parameters.csv')) {
    if ((row.parameterTypeName ?? '') === '' || (row.bindingSourceKind ?? 'NONE') !== 'NONE') {
      continue;
    }
    if ((row.typeReferenceLinkHash ?? '') === '') {
      failures.push(`parameter ${row.paramName}: annotated but no typeReferenceLinkHash`);
    }
  }

  // The fixture must actually produce the kinds that were broken, or this
  // passes by not testing them.
  for (const kind of ['TYPE_LITERAL_PROPERTY', 'PARAMETER_PROPERTY', 'PROPERTY_DECLARATION',
    'PROPERTY_SIGNATURE', 'TYPE_LITERAL_INDEX_SIGNATURE']) {
    if (!kinds.has(kind)) {
      failures.push(`the fixture produced no ${kind} — the check is vacuous for it`);
    }
  }

  console.log(`  ${linked} annotated field(s) across ${kinds.size} member kind(s) name a type ` +
    'reference row, shape members and parameter properties included');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  cleanup();
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 24. A type reference names its entity without type arguments
// ---------------------------------------------------------------------------

/**
 * A scope lookup needs the name as WRITTEN, minus the type arguments.
 *
 * `typeName` gives only the rightmost segment -- `Node` for
 * `Outer.Inner.Node<T>` -- and `completeTypeName` carries the arguments. So
 * neither is the qualified name, and a consumer had to find the first "<" by
 * hand to get it.
 *
 * The shortcut that looks right and is not: treating `typeName ==
 * completeTypeName` as the qualified/unqualified test. `Map<string, User>`
 * differs from `Map` for a reason that has nothing to do with qualification, so
 * that test misfiles every generic reference -- and half-resolving is harder to
 * notice than not resolving at all.
 *
 * The AST holds the answer directly: a TypeReferenceNode's `typeName` is an
 * EntityName and its `typeArguments` are a separate property. This is a read,
 * not a derivation, which is why it belongs in the IR.
 */
async function typeReferencesNameTheirEntity(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('type references name their entity',
      'no extractor yet. A reference must name the entity it writes, without type arguments');
  }
  const { outputDir, cleanup } = await analyseInline('ts-entity-', {
    'q.ts': [
      'export namespace Outer { export namespace Inner { export interface Node<T> { v: T } } }',
      'export interface Plain { x: number }',
      'export class Base<T> { v?: T }',
      'declare const a: Outer.Inner.Node<string>;',
      'declare const b: Plain;',
      'declare const c: Map<string, Plain>;',
      'declare const d: ReadonlyArray<Outer.Inner.Node<number>>;',
      'export class Sub extends Base<Plain> {}',
      'export const used = [a, b, c, d];',
    ].join('\n'),
  });

  // completeTypeName -> the entityName it must carry
  const expected = new Map<string, string>([
    ['Outer.Inner.Node<string>', 'Outer.Inner.Node'],   // qualified AND generic
    ['Plain', 'Plain'],                                  // neither
    ['Map<string, Plain>', 'Map'],                       // generic, not qualified
    ['ReadonlyArray<Outer.Inner.Node<number>>', 'ReadonlyArray'],
    ['Outer.Inner.Node<number>', 'Outer.Inner.Node'],    // nested inside the above
    ['Base<Plain>', 'Base'],                             // a heritage clause
  ]);
  const failures: string[] = [];
  const seen = new Set<string>();
  for (const row of relation(outputDir, 'all-typescript-type-references.csv')) {
    const complete = row.completeTypeName ?? '';
    const want = expected.get(complete);
    if (want === undefined) {
      continue;
    }
    seen.add(complete);
    const got = row.entityName ?? '';
    if (got !== want) {
      failures.push(`${complete}: entityName "${got}", expected "${want}"`);
    }
    // The whole point: the entity name must not still carry the arguments.
    if (got.includes('<')) {
      failures.push(`${complete}: entityName still carries type arguments`);
    }
  }
  for (const [complete] of expected) {
    if (!seen.has(complete)) {
      failures.push(`the fixture produced no reference for ${complete} — the check is vacuous ` +
        'for that form');
    }
  }

  console.log(`  ${expected.size} reference form(s): qualified, generic, qualified-and-generic, ` +
    'nested, and a heritage clause — each names its entity without arguments');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  cleanup();
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 25. Column order is append-only
// ---------------------------------------------------------------------------

/**
 * A column may be ADDED at the end. It may not be inserted in the middle.
 *
 * Souffle does not error on a width change: it binds the first N fields and a
 * join key silently lands on the wrong one. So inserting a column mid-table does
 * not break the consumer's build -- it changes what their rules mean, quietly,
 * and the failure surfaces as wrong answers somewhere else entirely.
 *
 * It has happened twice. `bindingPatternText` went into the middle of the
 * parameter table and cost a downstream day plus a retracted bug report against
 * us; `entityName` went in at index 10 of the type-reference table and was
 * caught only by the consumer's own drift gate. Both were avoidable, and
 * neither was noticed here.
 *
 * The baseline is committed alongside this check. Appending a column means
 * appending to the baseline in the same commit -- a visible diff naming the
 * table and the column, which is exactly the announcement that was asked for.
 * Reordering or inserting fails, by name, here.
 */
function columnOrderIsAppendOnly(): number {
  if (!parserPresent()) {
    return pendingCheck('column order is append-only',
      'no extractor yet. A column may be appended, never inserted mid-table');
  }
  const baselinePath = path.join(__dirname, 'typescript-gates', 'column-order.baseline.json');
  if (!fs.existsSync(baselinePath)) {
    return fail(`the column-order baseline is missing at ${baselinePath}`);
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8')) as Record<string, string[]>;
  const corpora = extractedCorpora();
  const failures: string[] = [];
  const observed = new Map<string, string[]>();

  for (const [, outputDir] of corpora) {
    for (const file of fs.readdirSync(outputDir)) {
      if (!file.startsWith('all-typescript-') || !file.endsWith('.csv')) {
        continue;
      }
      const text = fs.readFileSync(path.join(outputDir, file), 'utf-8');
      const head = text.split('\n')[0];
      if (head === undefined || head === '') {
        continue;
      }
      observed.set(file, head.split('\t'));
    }
  }

  for (const [file, want] of Object.entries(baseline)) {
    const got = observed.get(file);
    if (got === undefined) {
      // An empty relation emits no header. That is not a reordering.
      continue;
    }
    for (let i = 0; i < want.length; i += 1) {
      if (got[i] !== want[i]) {
        failures.push(`${file} column ${i}: baseline says "${want[i]}", emitted "${got[i]}" — a `
          + 'column was inserted or reordered. Souffle binds by position and will not error: it '
          + 'will bind the join key to the wrong field. Append instead, and add the new column to '
          + 'column-order.baseline.json in the same commit');
        break;
      }
    }
    if (got.length < want.length) {
      failures.push(`${file}: ${got.length} columns emitted where the baseline has ${want.length} `
        + '— a column was REMOVED, which no consumer can absorb');
    }
  }
  // A relation the baseline has never seen is also worth naming, since it means
  // the baseline was not updated alongside the schema.
  for (const file of observed.keys()) {
    if (baseline[file] === undefined) {
      failures.push(`${file} is emitted but absent from the baseline — add it`);
    }
  }

  const appended = [...observed.entries()]
    .filter(([f, got]) => baseline[f] !== undefined && got.length > baseline[f]!.length)
    .map(([f, got]) => `${f.replace('all-typescript-', '')} +${got.length - baseline[f]!.length}`);

  // The comparison NOTHING else makes: emitted width against DECLARED ARITY.
  //
  // `schema and generated .dl agree` compares the doc to the .dl (arity only);
  // the loop above compares the emitted header to the baseline (names only).
  // A column appended to the writer and to the baseline but never declared in
  // the schema passes both and still cannot be read, because Souffle is
  // ASYMMETRIC about field counts -- measured on 2.5:
  //
  //   too FEW fields  -> exit 1, "Values missing in line 1; cannot parse fact file"
  //   too MANY fields -> exit 0, nothing on stderr, the extra field dropped
  //
  // `-v` and `-W all` change neither. So an undeclared trailing column is
  // invisible everywhere except here. `strictBindCallApply` shipped that way
  // and #77's mechanism could not run for it.
  const arity = declaredArities();
  for (const [file, got] of observed.entries()) {
    const relation = relationNameFor(file);
    const declared = relation === undefined ? undefined : arity.get(relation);
    if (declared === undefined) {
      continue;
    }
    if (got.length !== declared) {
      failures.push(`${file}: ${got.length} columns emitted, but ${relation} is declared with `
        + `${declared} in decls_base_ts.dl. Souffle exits 0 and DROPS the extra field when the `
        + 'file is wider than the declaration, so the column is unreadable and nothing reports '
        + 'it. Add the column to the schema doc and regenerate');
    }
  }

  console.log(`  ${Object.keys(baseline).length} relation(s), `
    + `${Object.values(baseline).reduce((n, c) => n + c.length, 0)} columns pinned by position`
    + (appended.length > 0 ? `; appended since the baseline: ${appended.join(', ')}` : ''));
  console.log(`  ${arity.size} relation(s) cross-checked against the declared arity in `
    + 'decls_base_ts.dl');
  for (const f of failures.slice(0, 6)) console.log(`  ${f}`);
  return failures.length ? 1 : 0;
}


// ---------------------------------------------------------------------------
// Regression tests for the four fixes that shipped without one.
//
// Each synthesises its input with `analyseInline` / `analyseProgramsInline`
// rather than adding a corpus fixture, and each was verified to FAIL with its
// fix reverted -- a test that passes either way records the defect as intended.
// ---------------------------------------------------------------------------

/**
 * A file's governing tsconfig is a function of the FILE, not of the program
 * being extracted (#84).
 *
 * `beside.ts` sits next to a nested program whose tsconfig claims only `src/**`,
 * and the ROOT config claims everything. The resolver's walk used to stop at the
 * program root, so the nested program resolved `beside.ts` to no config at all
 * and emitted a SECOND `ts_module` row under the same primary key with a
 * different `moduleResolutionMode` -- and Souffle keeps both, so one import
 * yielded two contradictory resolution modes.
 */
async function governingConfigIsPerFile(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('governing tsconfig is per file',
      'no extractor yet. A file in two programs must mint ONE module row');
  }
  // Three things are all required to reproduce this, and dropping any one makes
  // the check vacuous:
  //   1. `pkg/tsconfig.json` EXISTS, so `pkg` becomes a nested program root;
  //   2. it does NOT claim `beside.ts` (it includes only `src/**`), while the
  //      ROOT config does — so the two programs disagree about the governing
  //      config unless the walk is program-independent;
  //   3. a file inside the nested program IMPORTS `beside.ts`, which is what
  //      pulls it into that program's closure as an "unclaimed" file. Without
  //      the import the nested program never touches it and only one row is
  //      ever emitted.
  const { outputDir, cleanup } = await analyseProgramsInline('ts-gov-', {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' },
      include: ['**/*.ts'],
    }),
    'pkg/tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'CommonJS' },
      include: ['src/**/*'],
    }),
    'pkg/src/inside.ts': "import { beside } from '../beside.js';\nexport const inside = beside;\n",
    'pkg/beside.ts': 'export const beside = 2;\n',
  });
  try {
    const modules = relation(outputDir, 'all-typescript-modules.csv');
    const failures: string[] = [];
    const byKey = new Map<string, Record<string, string>[]>();
    for (const row of modules) {
      const key = row['tsModuleUniqueHash'] ?? '';
      if (!byKey.has(key)) { byKey.set(key, []); }
      byKey.get(key)!.push(row);
    }
    for (const [key, group] of byKey) {
      if (group.length < 2) { continue; }
      const differing = Object.keys(group[0]!).filter(
        (c) => new Set(group.map((r) => r[c])).size > 1);
      failures.push(`${group.length} ts_module rows share key ${key} `
        + `(${group[0]!['filePath']}) differing in [${differing.join(', ')}] — Souffle keeps `
        + 'both, so a join on the module hash yields contradictory values');
    }
    const beside = modules.filter((r) => (r['filePath'] ?? '').endsWith('beside.ts'));
    if (beside.length !== 1) {
      failures.push(`beside.ts produced ${beside.length} ts_module row(s), expected exactly 1 `
        + '— it is claimed by the root config and reachable from the nested program');
    }
    console.log(`  ${modules.length} module row(s) over two programs, `
      + `${byKey.size} distinct key(s); beside.ts resolved once`);
    for (const f of failures.slice(0, 4)) { console.log(`  ${f}`); }
    return failures.length ? 1 : 0;
  } finally {
    cleanup();
  }
}

/**
 * A decorator subtree is descended once (#86).
 *
 * `visitDecoratorDeclarations` walks a member's decorators and `emitField` then
 * descended the whole member -- and `ts.forEachChild` yields a decorated node's
 * decorators alongside its initialiser, so the arrow inside `@Column(() => X)`
 * was emitted TWICE. `overloadIndex` was the only differing column and is not in
 * `TS_METHOD_md5`, so the two rows collided on one key as a false overload set.
 */
async function decoratorDescendedOnce(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('a decorator is descended once',
      'no extractor yet. A callable inside a decorator argument is ONE method');
  }
  const { outputDir, cleanup } = await analyseInline('ts-decdup-', {
    // The decorated properties MUST have initialisers. `emitField` only
    // descends the member when one is present -- and it descends the whole
    // member, decorators included, which is where the second emission came
    // from. Without an initialiser the defect does not reproduce and the test
    // passes with the fix reverted, which is how the first draft of this check
    // was vacuous.
    'a.ts': [
      'function Column(_fn: () => unknown, _o?: object): PropertyDecorator {',  // 1
      '  return () => {};',                                                     // 2
      '}',                                                                      // 3
      'export class Post {',                                                    // 4
      '  @Column(() => Post, { eager: true })',                                 // 5
      '  author: Post = this;',                                                 // 6
      '',                                                                       // 7
      '  @Column(() => Post)',                                                  // 8
      '  editor: Post = this;',                                                 // 9
      '}',
    ].join('\n'),
  }, { experimentalDecorators: true });
  try {
    const methods = relation(outputDir, 'all-typescript-methods.csv');
    const failures: string[] = [];
    const seen = new Map<string, number>();
    for (const row of methods) {
      const key = row['tsMethodUniqueHash'] ?? '';
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [key, n] of seen) {
      if (n > 1) { failures.push(`${n} ts_method rows share key ${key}`); }
    }
    // ONE arrow per decorator POSITION. Two DISTINCT anonymous arrows in one
    // class legitimately share a name and get overloadIndex 0 and 1, so the
    // index says nothing here -- the defect was the SAME arrow emitted twice,
    // which is a count at one position.
    const arrows = methods.filter((r) => r['methodKind'] === 'ARROW_FUNCTION');
    for (const line of ['5', '8']) {
      const atLine = arrows.filter((r) => r['startLine'] === line);
      if (atLine.length !== 1) {
        failures.push(`${atLine.length} arrows emitted at line ${line}, expected 1 — the `
          + 'decorator subtree was descended twice, once by visitDecoratorDeclarations and '
          + 'again by emitField');
      }
    }
    const positions = new Set(arrows.map((r) => `${r['startLine']}:${r['startColumn']}`));
    if (positions.size !== arrows.length) {
      failures.push(`${arrows.length} arrow rows occupy only ${positions.size} distinct `
        + 'position(s) — two rows describe one node');
    }
    console.log(`  ${methods.length} method row(s), ${seen.size} distinct key(s); `
      + `${arrows.length} decorator-argument arrow(s) at ${positions.size} distinct position(s)`);
    for (const f of failures.slice(0, 4)) { console.log(`  ${f}`); }
    return failures.length ? 1 : 0;
  } finally {
    cleanup();
  }
}

/**
 * `.d.mts` and `.d.cts` are declaration files, and their stem is not `index.d`
 * (#89).
 *
 * `stripExtension` listed `d\.ts|tsx?|mts|cts`, so `index.d.cts` matched the bare
 * `cts` arm and kept a stray `.d`. `resolvedFilePath` and `resolvedExtension`
 * then could not be recombined into the real path, and the module's own name
 * carried the `.d`.
 */
async function declarationExtensionsAreWholeExtensions(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('declaration extensions are whole extensions',
      'no extractor yet. `.d.cts` and `.d.mts` are single extensions');
  }
  const { outputDir, cleanup } = await analyseInline('ts-dext-', {
    // Its own tsconfig on purpose: `analyseInline`'s default `include` is
    // `**/*.ts`, which does not match `.d.cts` or `.d.mts` at all. Omitting
    // `include` is what tsc does by default and picks up all four -- verified
    // against `parseJsonConfigFileContent`, which returns the same four files.
    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' },
    }),
    'legacy.d.cts': 'export declare const legacy: number;\n',
    'modern.d.mts': 'export declare const modern: number;\n',
    'plain.d.ts': 'export declare const plain: number;\n',
    'src.ts': 'export const src = 1;\n',
  });
  try {
    const modules = relation(outputDir, 'all-typescript-modules.csv');
    const failures: string[] = [];
    for (const row of modules) {
      for (const column of ['name', 'qualifiedName'] as const) {
        const value = row[column] ?? '';
        if (value.endsWith('.d')) {
          failures.push(`${row['fileName']}: ${column} is "${value}" — the `
            + '`.d` of a `.d.cts`/`.d.mts` extension was left on the stem');
        }
      }
    }
    const want = ['legacy.d.cts', 'modern.d.mts', 'plain.d.ts'];
    for (const file of want) {
      const row = modules.find((r) => r['fileName'] === file);
      if (row === undefined) {
        failures.push(`no ts_module row for ${file}`);
        continue;
      }
      if (row['isDeclarationFile'] !== 'true') {
        failures.push(`${file}: isDeclarationFile is ${row['isDeclarationFile']}`);
      }
    }
    console.log(`  ${modules.length} module row(s) across .d.cts, .d.mts, .d.ts and .ts; `
      + 'no stem carries a stray `.d`');
    for (const f of failures.slice(0, 4)) { console.log(`  ${f}`); }
    return failures.length ? 1 : 0;
  } finally {
    cleanup();
  }
}

/**
 * A variable's annotation can declare a SET of call signatures (#88, #92).
 *
 * `declaredCallSignatureOf` returned at most one signature, so a type LITERAL
 * with several call signatures fell through to the arrow initialiser and the row
 * said `overloadCandidateCount = 1` where tsc sees several. Where arity narrows
 * the set the parser now resolves to the same arm `getResolvedSignature` does.
 */
async function annotationCanDeclareASignatureSet(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('an annotation can declare a signature set',
      'no extractor yet. A type literal may hold several call signatures');
  }
  const { outputDir, cleanup } = await analyseInline('ts-sigset-', {
    'a.ts': [
      'export const distinguishable: {',            // 1
      '  (a: string): void;',                       // 2  <- arm 0
      '  (a: string, b: number): void;',            // 3  <- arm 1
      '} = (_a: string, _b?: number): void => {};', // 4
      'export const ambiguous: {',                  // 5
      '  (a?: string): void;',                      // 6
      '  (a?: string, b?: number): void;',          // 7
      '} = (_a?: string, _b?: number): void => {};',// 8
      'export const plain: (a: string) => void = (_a: string): void => {};', // 9
      'export function exercise(): void {',         // 10
      '  distinguishable("x");',                    // 11 -> arm at line 2
      '  distinguishable("x", 1);',                 // 12 -> arm at line 3
      '  ambiguous("x");',                          // 13 -> cannot narrow
      '  plain("x");',                              // 14 -> unchanged control
      '}',
    ].join('\n'),
  });
  try {
    const calls = relation(outputDir, 'all-typescript-call-sites.csv');
    const methodLine = new Map(relation(outputDir, 'all-typescript-methods.csv')
      .map((r) => [r['tsMethodUniqueHash'] ?? '', r['startLine'] ?? '']));
    const at = (line: string): Record<string, string> | undefined =>
      calls.find((r) => r['startLine'] === line);
    const failures: string[] = [];
    const expect = (line: string, targetLine: string, count: string, resolved: string): void => {
      const row = at(line);
      if (row === undefined) {
        failures.push(`no call site at line ${line}`);
        return;
      }
      const got = methodLine.get(row['resolvedSignatureLinkHash'] ?? '') ?? '<none>';
      if (got !== targetLine) {
        failures.push(`call at line ${line} resolved to a method at line ${got}, `
          + `expected ${targetLine}`);
      }
      if ((row['overloadCandidateCount'] ?? '') !== count) {
        failures.push(`call at line ${line} reports overloadCandidateCount `
          + `${row['overloadCandidateCount']}, expected ${count}`);
      }
      if ((row['isOverloadResolved'] ?? '') !== resolved) {
        failures.push(`call at line ${line} reports isOverloadResolved `
          + `${row['isOverloadResolved']}, expected ${resolved}`);
      }
    };
    // Arity narrows the set: the chosen arm is the one tsc chooses.
    expect('11', '2', '2', 'true');
    expect('12', '3', '2', 'true');
    // Arity cannot narrow it -- both arms are all-optional. The target stays the
    // initialiser, because the engine's `parser_resolved` projection reads the
    // signature hash and ignores the count, so dropping the target would cost a
    // resolution and give nothing. What must NOT happen is a claim of one candidate.
    expect('13', '8', '2', 'false');
    // Control: a plain function-type annotation is untouched.
    expect('14', '9', '1', 'false');
    console.log('  4 call(s): two arms chosen by arity as tsc chooses them, one all-optional '
      + 'set reported as 2 candidates with the initialiser kept, one plain annotation unchanged');
    for (const f of failures.slice(0, 6)) { console.log(`  ${f}`); }
    return failures.length ? 1 : 0;
  } finally {
    cleanup();
  }
}


/**
 * An object literal's property KEY reaches the IR (#111).
 *
 * Only `property.initializer` was pushed, so no key was emitted anywhere in the
 * 21 relations -- a rule keyed on an HTTP header or a JSON field name could not
 * be written at all. Python already emits these (`PythonEdgeRole.KEY`).
 *
 * Two properties the check will not let regress: the key must NOT be bound as a
 * scope reference (`{ amount_cents: 1 }` beside a local `amount_cents` would
 * bind to the variable), and a COMPUTED key must emit nothing, so a lone value
 * row means "dynamic" rather than "absent".
 */
async function objectLiteralKeysReachTheIr(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('object-literal keys reach the IR',
      'no extractor yet. A property key is a fact, not only its value');
  }
  const { outputDir, cleanup } = await analyseInline('ts-objkey-', {
    'a.ts': [
      'const amount_cents = 999;',                    // a same-named local, on purpose
      'const shorthand = 1;',
      'const dynamic = "d";',
      'export const payload = {',
      "  'X-Signature': 'sha256',",                   // quoted key
      '  amount_cents: 1000,',                        // identifier key, shadowing risk
      '  shorthand,',                                 // key AND value reference
      '  [dynamic]: 2,',                              // computed -> no key row
      '};',
    ].join('\n'),
  });
  try {
    const exprs = relation(outputDir, 'all-typescript-expressions.csv');
    const keys = exprs.filter((r) => r['edgeRole'] === 'OBJECT_PROPERTY_KEY');
    const values = exprs.filter((r) => r['edgeRole'] === 'OBJECT_PROPERTY_VALUE');
    const failures: string[] = [];
    const names = new Set(keys.map((r) => r['literalValue']));
    for (const want of ['X-Signature', 'amount_cents', 'shorthand']) {
      if (!names.has(want)) {
        failures.push(`no OBJECT_PROPERTY_KEY row carries "${want}" — the key never reached `
          + 'the IR, so a rule keyed on a field name cannot be written');
      }
    }
    // A key is a name, never a scope lookup.
    for (const key of keys) {
      if ((key['referencedEntityHash'] ?? '') !== '') {
        failures.push(`key "${key['literalValue']}" is bound to `
          + `${key['referencedEntityHash']} — a key must not resolve against the lexical chain`);
      }
    }
    // A computed key emits nothing, so its value stands alone at its position.
    if (names.has('dynamic') || names.has('d')) {
      failures.push('a computed key emitted an OBJECT_PROPERTY_KEY row — it cannot be named '
        + 'from syntax and a lone value row is how a consumer sees that');
    }
    // Key and value join on (parent, position).
    for (const key of keys) {
      const paired = values.some((v) => v['parentExpressionHash'] === key['parentExpressionHash']
        && v['position'] === key['position']);
      if (!paired) {
        failures.push(`key "${key['literalValue']}" has no value at the same `
          + '(parentExpressionHash, position), so the two cannot be joined');
      }
    }
    console.log(`  ${keys.length} key row(s) and ${values.length} value row(s); quoted, `
      + 'identifier and shorthand keys named, computed key correctly absent, none bound');
    for (const f of failures.slice(0, 5)) { console.log(`  ${f}`); }
    return failures.length ? 1 : 0;
  } finally {
    cleanup();
  }
}


/**
 * An import that binds NOTHING still records its module edge (#110).
 *
 * `import type {} from "pkg"` is the idiom for pulling in a package's ambient
 * declarations, and `import {} from "pkg"` is a runtime load identical in
 * effect to `import "pkg"`. Both have `NamedImports` with zero elements, so a
 * per-binding loop emitted no row and the specifier appeared NOWHERE in the
 * IR. Library staging is derived from the client IR's own imports, so such a
 * package could not be staged and every target it declares was charged as a
 * miss.
 *
 * The row must carry what staging reads -- specifier, resolved path and
 * package name -- and `isTypeOnly` must still separate the two forms.
 */
async function emptyImportsRecordTheirModuleEdge(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('empty imports record their module edge',
      'no extractor yet. An import that binds nothing is still a module edge');
  }
  const { outputDir, cleanup } = await analyseInline('ts-emptyimp-', {
    'a.ts': [
      "import type {} from './amb';",     // type-only, binds nothing
      "import {} from './rt';",           // value, binds nothing
      "import './fx';",                   // control: already worked
      "import type { T } from './named';", // control: type-only WITH a binding
      'export const x = 1;',
    ].join('\n'),
    'amb.ts': 'declare global { interface Window { flag: boolean } }\nexport const a = 1;\n',
    'rt.ts': 'export const r = 1;\n',
    'fx.ts': 'export const f = 1;\n',
    'named.ts': 'export type T = string;\n',
  });
  try {
    const imports = relation(outputDir, 'all-typescript-imports.csv');
    const failures: string[] = [];
    const expect = (spec: string, typeOnly: string, kind: string): void => {
      const rows = imports.filter((r) => r['importedPath'] === spec);
      if (rows.length !== 1) {
        failures.push(`${spec}: ${rows.length} import row(s), expected 1 — an import that `
          + 'binds nothing still carries a module edge, and staging is derived from these rows');
        return;
      }
      const row = rows[0]!;
      if (row['isTypeOnly'] !== typeOnly) {
        failures.push(`${spec}: isTypeOnly is ${row['isTypeOnly']}, expected ${typeOnly}`);
      }
      if (row['importKind'] !== kind) {
        failures.push(`${spec}: importKind is ${row['importKind']}, expected ${kind}`);
      }
      // What staging actually reads.
      if ((row['resolvedFilePath'] ?? '') === '') {
        failures.push(`${spec}: resolvedFilePath is empty, so the target cannot be staged`);
      }
    };
    expect('./amb', 'true', 'SIDE_EFFECT');
    expect('./rt', 'false', 'SIDE_EFFECT');
    expect('./fx', 'false', 'SIDE_EFFECT');
    expect('./named', 'true', 'TYPE_ONLY_NAMED');
    console.log(`  ${imports.length} import row(s): an empty type-only and an empty value `
      + 'import each record their edge, both resolved, and isTypeOnly still separates them');
    for (const f of failures.slice(0, 5)) { console.log(`  ${f}`); }
    return failures.length ? 1 : 0;
  } finally {
    cleanup();
  }
}


/**
 * A member of a REOPENED type shares one group key across files (#149).
 *
 * `ts_field` has carried this since it was written — `memberGroupKey`, "the
 * member's identity ACROSS a merged owner" — and `ts_method` never did, so
 * every interface member had an EMPTY `declarationGroupKey`. A consumer then
 * reported one construct signature against another as a WRONG answer rather
 * than an overload sibling.
 *
 * Adjudicated against tsc via the MERGED symbol, not the declaration-local
 * one: `getSymbolAtLocation(name)` -> `getDeclaredTypeOfSymbol` reports `make`
 * with 2 declarations and construct/call signatures from both files, while
 * `(member as any).symbol` reports 1 each — the trap that makes this look like
 * a non-merge.
 */
async function reopenedTypeMembersShareAGroupKey(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('reopened type members share a group key',
      'no extractor yet. A member of a merged owner has one identity');
  }
  const { outputDir, cleanup } = await analyseInline('ts-merged-', {
    'a.d.ts': [
      'interface BoxCtor {',
      '  new (v: string): object;',
      '  (v: string): object;',
      '  make(v: string): object;',
      '}',
    ].join('\n'),
    'b.d.ts': [
      'interface BoxCtor {',
      '  new (v: string, n: number): object;',
      '  (v: string, n: number): object;',
      '  make(v: string, n: number): object;',
      '}',
    ].join('\n'),
  });
  try {
    const own = relation(outputDir, 'all-typescript-methods.csv')
      .filter((r) => r['ownerTypeName'] === 'BoxCtor');
    const failures: string[] = [];
    const byKind = new Map<string, string[]>();
    for (const r of own) {
      const kind = r['methodKind'] ?? '';
      if ((r['declarationGroupKey'] ?? '') === '') {
        failures.push(`${r['filePath']}:${r['startLine']} ${kind} has an EMPTY `
          + 'declarationGroupKey — §4.7 c22 defines it as the overload set’s identity, and '
          + 'for a reopened interface that set spans files');
        continue;
      }
      if (!byKind.has(kind)) { byKind.set(kind, []); }
      byKind.get(kind)!.push(r['declarationGroupKey'] ?? '');
    }
    // Each member kind is declared once per file, so its two rows must share
    // one key — and the three kinds must not collapse into each other.
    const keys = new Set<string>();
    for (const kind of ['CONSTRUCT_SIGNATURE', 'CALL_SIGNATURE', 'METHOD_SIGNATURE']) {
      const got = byKind.get(kind) ?? [];
      if (got.length !== 2) {
        failures.push(`${kind}: ${got.length} row(s) with a group key, expected 2`);
        continue;
      }
      if (got[0] !== got[1]) {
        failures.push(`${kind}: the two declarations have DIFFERENT group keys, so a `
          + 'consumer cannot tell they are siblings of one merged interface');
      }
      keys.add(got[0]!);
    }
    if (keys.size !== 3) {
      failures.push(`the three member kinds collapsed into ${keys.size} group(s) — a `
        + 'construct signature, a call signature and a method are different members');
    }
    console.log(`  ${own.length} member row(s) over two declarations of one interface; `
      + `${keys.size} distinct group(s), each shared by both files`);
    for (const f of failures.slice(0, 5)) { console.log(`  ${f}`); }
    return failures.length ? 1 : 0;
  } finally {
    cleanup();
  }
}

/** `all-typescript-method-parameters.csv` -> `ts_method_parameter`, via the .dl's own names. */
function relationNameFor(file: string): string | undefined {
  const stem = file.replace('all-typescript-', '').replace('.csv', '');
  const singular = stem.endsWith('ies')
    ? `${stem.slice(0, -3)}y`
    : stem.endsWith('sses') || stem.endsWith('xes')
      ? stem.slice(0, -2)
      : stem.endsWith('s') ? stem.slice(0, -1) : stem;
  return `ts_${singular.replace(/-/g, '_')}`;
}

/** Declared arity per relation, read from the GENERATED .dl rather than the doc. */
function declaredArities(): Map<string, number> {
  const out = new Map<string, number>();
  const dl = path.join(SCHEMA_DIR, 'decls_base_ts.dl');
  if (!fs.existsSync(dl)) {
    return out;
  }
  for (const m of fs.readFileSync(dl, 'utf-8').matchAll(/^\.decl\s+(\w+)\(([^)]*)\)/gm)) {
    const name = m[1];
    const params = m[2];
    if (name === undefined || params === undefined || name.startsWith('lib_')) {
      continue;
    }
    out.set(name, params.split(',').length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 26. Every constrained type parameter names its bound
// ---------------------------------------------------------------------------

/**
 * A bound is only usable if it is reachable as a ROW.
 *
 * `constraintText` is the source text. Following it -- to the interface the
 * bound names, through `keyof T` -- needs the reference tree, reached through
 * `constraintReferenceLinkHash`.
 *
 * Class, interface, method and function parameters carried it. The two TYPE-LEVEL
 * owners did not: a mapped type's `[K in keyof T]` and an `infer U extends
 * string` declare a constraint that the ENCLOSING type's tree emits, so the
 * parameter row had the text and nothing pointing at the reference. That is the
 * third instance of the same shape, after the signature return and the shape
 * member, and on one library it was 57 of 928 constrained parameters.
 *
 * TypeScript's bound vocabulary is wider than one context: a bound on a type
 * owner, a bound on a METHOD owner (the split Java makes), a DEFAULT, and a
 * mapped constraint are four different facts, and the fixture exercises each so
 * none can regress silently.
 */
async function constrainedTypeParametersNameTheirBound(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('constrained type parameters name their bound',
      'no extractor yet. A bound must be reachable as a row, not only readable as text');
  }
  const { outputDir, cleanup } = await analyseInline('ts-bound-', {
    'b.ts': [
      'export interface Base { id: string }',
      'export interface Aud { at: number }',
      'export class Svc<T extends Base & Aud> {',
      '  find<K extends keyof T>(k: K): T[K] { return null as never; }',
      '  pick<U extends Base = Base>(u: U): U { return u; }',
      '}',
      'export interface Repo<T extends Base, S = T[]> { all(): S }',
      'export type Keys<T> = { [K in keyof T]: T[K] };',
      'export type Un<T> = T extends Promise<infer U extends object> ? U : never;',
      'export function free<A extends string, B extends A>(a: A, b: B) { return [a, b]; }',
    ].join('\n'),
  });

  const references = new Map(relation(outputDir, 'all-typescript-type-references.csv')
    .map((r) => [r.tsTypeReferenceUniqueHash ?? '', r]));
  const rows = relation(outputDir, 'all-typescript-type-parameters.csv');
  const failures: string[] = [];
  const owners = new Set<string>();
  let bounds = 0, defaults = 0;

  for (const row of rows) {
    owners.add(row.ownerKind ?? '');
    if ((row.constraintText ?? '') !== '') {
      const hash = row.constraintReferenceLinkHash ?? '';
      if (hash === '') {
        failures.push(`${row.ownerKind} ${row.paramName}: bound "${row.constraintText}" has no ` +
          'constraintReferenceLinkHash — the bound is text only');
      } else if (!references.has(hash)) {
        failures.push(`${row.ownerKind} ${row.paramName}: constraintReferenceLinkHash is DANGLING`);
      } else {
        bounds += 1;
      }
    }
    if ((row.defaultText ?? '') !== '') {
      const hash = row.defaultReferenceLinkHash ?? '';
      if (hash === '' || !references.has(hash)) {
        failures.push(`${row.ownerKind} ${row.paramName}: default "${row.defaultText}" has no ` +
          'usable defaultReferenceLinkHash');
      } else {
        defaults += 1;
      }
    }
  }

  // The type-LEVEL owners are the ones that were broken; assert the fixture
  // produced them, or the check passes by not reaching them.
  for (const owner of ['CLASS', 'INTERFACE', 'METHOD', 'FUNCTION', 'MAPPED_TYPE', 'INFER_TYPE']) {
    if (!owners.has(owner)) {
      failures.push(`the fixture produced no ${owner} type parameter — vacuous for that owner`);
    }
  }
  // The four bound-bearing contexts must all appear.
  const contexts = new Set(relation(outputDir, 'all-typescript-type-references.csv')
    .map((r) => r.context ?? ''));
  for (const context of ['TYPE_PARAM_BOUND', 'METHOD_TYPE_PARAM_BOUND', 'TYPE_PARAM_DEFAULT',
    'MAPPED_CONSTRAINT']) {
    if (!contexts.has(context)) {
      failures.push(`no type reference with context ${context}`);
    }
  }

  console.log(`  ${bounds} bound(s) and ${defaults} default(s) reach a reference row across ` +
    `${owners.size} owner kind(s), type-level owners included`);
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  cleanup();
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 27. A type variable names the parameter that declares it
// ---------------------------------------------------------------------------

/**
 * `typeVariableName` is a string. Substitution starts from the DECLARATION.
 *
 * A reference to `T` carried the name and nothing pointing at the parameter row
 * -- 4,772 references on one library. The column for it exists and is documented
 * ("FK to ts_type_parameter when this reference IS a type variable"); it was
 * simply never filled, so no new column is needed and no consumer has to remap.
 *
 * The name alone is not enough, which is the whole point: a method's `T`
 * SHADOWS its class's `T` and they are different entities. Resolving by name
 * against a flat set would pick one arbitrarily, so the fixture puts the two in
 * one class and asserts each reference reaches its own declaration.
 */
async function typeVariablesNameTheirParameter(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('type variables name their parameter',
      'no extractor yet. A type-variable reference must link the parameter that declares it');
  }
  const { outputDir, cleanup } = await analyseInline('ts-tvar-', {
    's.ts': [
      'export class Box<T> {',
      '  outer(v: T): T { return v; }',
      '  inner<T>(v: T): T { return v; }',           // shadows the class T
      '  two<A, B extends A>(a: A, b: B) { return [a, b]; }',  // B's bound names A
      '}',
      'export interface Repo<T, S = T[]> { all(): S }',
      'export type Keys<T> = { [K in keyof T]: T[K] };',
      'export function free<U>(u: U): U { return u; }',
    ].join('\n'),
  });

  const parameters = new Map(relation(outputDir, 'all-typescript-type-parameters.csv')
    .map((r) => [r.tsTypeParameterUniqueHash ?? '', r]));
  const references = relation(outputDir, 'all-typescript-type-references.csv')
    .filter((r) => r.kind === 'TYPE_VARIABLE');
  const failures: string[] = [];
  const owners = new Set<string>();

  if (references.length === 0) {
    failures.push('the fixture produced no TYPE_VARIABLE reference at all');
  }
  for (const row of references) {
    const hash = row.typeParameterLinkHash ?? '';
    if (hash === '') {
      failures.push(`${row.typeVariableName} at line ${row.startLine}: no typeParameterLinkHash ` +
        '— the reference names a string and nothing else');
      continue;
    }
    const declaration = parameters.get(hash);
    if (!declaration) {
      failures.push(`${row.typeVariableName}: typeParameterLinkHash is DANGLING`);
      continue;
    }
    owners.add(declaration.ownerKind ?? '');
    if (declaration.paramName !== row.typeVariableName) {
      failures.push(`${row.typeVariableName} at line ${row.startLine} links a parameter named ` +
        `${declaration.paramName}`);
    }
  }

  // SHADOWING. `outer` uses the class T (line 1); `inner` declares its own on
  // line 3 and must reach that one. Getting this wrong is invisible without it.
  const outerT = references.filter((r) => r.startLine === '2');
  const innerT = references.filter((r) => r.startLine === '3');
  for (const [label, rows, wantOwner] of [
    ['outer', outerT, 'CLASS'], ['inner', innerT, 'METHOD'],
  ] as [string, Record<string, string>[], string][]) {
    if (rows.length === 0) {
      failures.push(`no TYPE_VARIABLE reference on the ${label} line — the shadowing case is ` +
        'not being exercised');
      continue;
    }
    for (const row of rows) {
      const owner = parameters.get(row.typeParameterLinkHash ?? '')?.ownerKind;
      if (owner !== wantOwner) {
        failures.push(`${label}: T resolves to a ${owner} parameter, expected ${wantOwner} — a ` +
          "method's T shadows its class's T and they are different entities");
      }
    }
  }

  console.log(`  ${references.length} type-variable reference(s) name their declaration across ` +
    `${owners.size} owner kind(s); a shadowed T reaches the inner one`);
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  cleanup();
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 28. An object-literal member names the literal that owns it
// ---------------------------------------------------------------------------

/**
 * `const ctx: Ctx = { push(code) { … } }` types `code` through `Ctx.push`.
 *
 * Reaching it takes five hops, and four already existed: literal to variable
 * (`initializerExpressionLinkHash`), variable to its declared type, the type,
 * its member signature. Only member to literal was missing, so the member had
 * no owner at all and its parameters could not be typed from context.
 *
 * The owner is a `ts_expression` row -- the third relation c7 points at, after
 * `ts_type` and `ts_type_reference`. The three prefixes differ, so a rule
 * joining the wrong one finds NO match rather than a wrong one, which is what
 * makes a polymorphic FK safe here.
 *
 * The literal is found through the expression extractor's per-node index rather
 * than the walker's ROOT index, so a literal passed as an ARGUMENT or nested in
 * another literal is covered too -- those are not roots, and a root-only lookup
 * would silently cover only the variable-initialiser case.
 */
async function objectLiteralMembersNameTheirLiteral(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('object-literal members name their literal',
      'no extractor yet. A member of an object literal must name the literal that owns it');
  }
  const { outputDir, cleanup } = await analyseInline('ts-objlit-', {
    'o.ts': [
      'interface Ctx { push(code: string, n?: number): void; indent(): void }',
      'declare function run(c: Ctx): void;',
      'export function make(): Ctx {',
      '  const ctx: Ctx = {',
      '    push(code, n) { code.trim(); void n; },',
      '    indent() {},',
      '  };',
      '  run({ push(c) { void c; }, indent() {} });',   // literal as an ARGUMENT
      '  const outer = { inner: { deep() { return 1; } } };',  // NESTED literal
      '  void outer;',
      '  return ctx;',
      '}',
    ].join('\n'),
  });

  const expressions = new Map(relation(outputDir, 'all-typescript-expressions.csv')
    .map((e) => [e.tsExpressionUniqueHash ?? '', e]));
  const variables = relation(outputDir, 'all-typescript-variables.csv');
  const members = relation(outputDir, 'all-typescript-methods.csv')
    .filter((m) => m.methodKind === 'OBJECT_LITERAL_METHOD');
  const failures: string[] = [];

  if (members.length < 5) {
    failures.push(`expected at least 5 object-literal methods, found ${members.length} — the ` +
      'argument and nested forms may not be exercised');
  }
  for (const member of members) {
    const owner = expressions.get(member.tsTypeLinkHash ?? '');
    if ((member.tsTypeLinkHash ?? '') === '') {
      failures.push(`${member.name}: no owner — the member cannot be typed from the literal`);
    } else if (!owner) {
      failures.push(`${member.name}: owner FK is DANGLING`);
    } else if (owner.kind !== 'OBJECT_LITERAL') {
      failures.push(`${member.name}: owner is a ${owner.kind}, expected OBJECT_LITERAL`);
    }
  }

  // The whole chain, end to end: the point is not the link but what it completes.
  const push = members.find((m) => m.name === 'push' && m.tsTypeLinkHash !== '');
  if (push) {
    const holder = variables.find((v) => v.initializerExpressionLinkHash === push.tsTypeLinkHash);
    if (!holder) {
      failures.push('the literal owning `push` is not the initializer of any variable — hop 2 ' +
        'of the chain is broken');
    } else if ((holder.typeReferenceLinkHash ?? '') === '') {
      failures.push(`the variable ${holder.name} has no declared type — hop 3 is broken`);
    }
  } else {
    failures.push('no owned `push` member to walk the chain from');
  }

  console.log(`  ${members.length} object-literal member(s) name their literal, argument and ` +
    'nested forms included; the member-to-type chain walks end to end');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  cleanup();
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 29. A row's own paths are self-consistent
// ---------------------------------------------------------------------------

/**
 * `baseMservPath + filePath` must be the file. §4.4 says `filePath` is
 * repo-relative, and the module PK is `md5(filePath ‖ baseMservPath ‖ …)`, so
 * the key is only unique if that holds.
 *
 * Anchoring on the analysed directory instead broke both on a workspace.
 * Analysing `packages/alpha` with the repo root as `baseMservPath` emitted
 * `src/Project.ts`: the join named a file that does not exist, and
 * `packages/beta/src/Project.ts` produced the BYTE-IDENTICAL primary key. Two
 * packages' files were one row, and a position join could not be sound for
 * anyone.
 *
 * The single-project case -- the two paths equal -- must stay byte-identical,
 * which is what makes this a fix rather than a churn.
 */
async function rowPathsAreSelfConsistent(): Promise<number> {
  if (!parserPresent()) {
    return pendingCheck('row paths are self-consistent',
      'no extractor yet. baseMservPath + filePath must name the file');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ws-'));
  for (const pkg of ['alpha', 'beta']) {
    const dir = path.join(root, 'packages', pkg, 'src');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'Project.ts'),
      `export class Project { name = "${pkg}"; run() { return this.name; } }\n`);
    fs.writeFileSync(path.join(root, 'packages', pkg, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
      include: ['src/**/*'],
    }));
  }

  const failures: string[] = [];
  const keys = new Map<string, string>();
  for (const pkg of ['alpha', 'beta']) {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), `ts-ws-${pkg}-`));
    await new TypeScriptProjectAnalyzer().analyze({
      // The workspace shape: analyse ONE package, anchored at the repo root.
      rootDir: path.join(root, 'packages', pkg), outputDir, baseMservPath: root,
      serviceVersionLink: 'ws-check',
    });
    // EVERY relation, not just modules. filePath is computed once and inherited,
    // and the child relations chain their keys off a parent hash -- so a fix
    // applied at one site should hold everywhere, and this is what proves it
    // rather than assuming it.
    for (const file of fs.readdirSync(outputDir)) {
      if (!file.startsWith('all-typescript-') || !file.endsWith('.csv')) {
        continue;
      }
      const rows = relation(outputDir, file);
      const primaryKey = rows.length > 0
        ? Object.keys(rows[0]!).find((c) => c.endsWith('UniqueHash'))
        : undefined;
      for (const row of rows) {
        if ((row.filePath ?? '') !== '') {
          const joined = path.join(row.baseMservPath ?? root, row.filePath!);
          if (!fs.existsSync(joined)) {
            failures.push(`${pkg} ${file}: baseMservPath + filePath = "${row.filePath}" names no ` +
              'file — the row is not self-consistent');
          }
          if (!row.filePath!.includes(pkg)) {
            failures.push(`${pkg} ${file}: filePath "${row.filePath}" carries no package ` +
              "qualifier, so two packages' identically-named files cannot be told apart");
          }
        }
        // tsConfigPath must locate the config, not just name it.
        if ((row.tsConfigPath ?? '') !== '' && !row.tsConfigPath!.includes('/')) {
          failures.push(`${pkg} ${file}: tsConfigPath "${row.tsConfigPath}" is a bare filename ` +
            'and cannot identify which package governed the file');
        }
        if (primaryKey !== undefined) {
          const key = `${file}|${row[primaryKey] ?? ''}`;
          const previous = keys.get(key);
          if (previous !== undefined && previous !== pkg) {
            failures.push(`${file}: a key from ${pkg} is byte-identical to one from ${previous} ` +
              '— two packages collide on one row');
          }
          keys.set(key, pkg);
        }
      }
    }
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  // A single-project run must be untouched: paths stay relative to the root.
  const soloOut = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ws-solo-'));
  const soloRoot = path.join(root, 'packages', 'alpha');
  await new TypeScriptProjectAnalyzer().analyze({
    rootDir: soloRoot, outputDir: soloOut, baseMservPath: soloRoot,
    serviceVersionLink: 'ws-check',
  });
  for (const row of relation(soloOut, 'all-typescript-modules.csv')) {
    if (row.filePath !== 'src/Project.ts') {
      failures.push(`a single-project run emitted "${row.filePath}", expected "src/Project.ts" — ` +
        'the common case must not change');
    }
  }
  fs.rmSync(soloOut, { recursive: true, force: true });

  console.log(`  ${keys.size} key(s) across every relation of two workspace packages: paths join ` +
    'to a real file, carry the package, and no relation collides; a single-project run is ' +
    'unchanged');
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  fs.rmSync(root, { recursive: true, force: true });
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 30. Parameters declared INSIDE a type are type variables
// ---------------------------------------------------------------------------

/**
 * `[K in keyof T]` and `infer U` declare type parameters, and both read
 * TYPE_REFERENCE until #65 -- so `K` looked like a nominal type named "K".
 *
 * The cause was that scope was built from declarations carrying a
 * `typeParameters` ARRAY, and neither of these has one: a mapped type has
 * `typeParameter` singular, an infer node likewise.
 *
 * This check asserts the KIND of named references, which the neighbouring
 * "type variables name their parameter" check structurally cannot do -- it
 * iterates rows that are ALREADY TYPE_VARIABLE, so every misfiling here
 * passed it vacuously. A blind spot in an assertion outlives the bug.
 *
 * `infer` is the harder half and is covered deliberately: the name is written
 * in the conditional's `extends` clause but READ in the true branch, which is
 * a SIBLING of that clause. Scoping it to the infer node's own subtree fixes
 * `K` and leaves `U` broken, which is exactly what the first fix here did.
 */
async function parametersDeclaredInsideATypeAreVariables(): Promise<number> {
  const { outputDir, cleanup } = await analyseInline('ts-inner-tp-', {
    's.ts': [
      'export type Keys<T> = { [K in keyof T]: T[K] };',
      'export type Awaited1<T> = T extends Promise<infer U> ? U : T;',
      // U read in the true branch, nested one type-argument deep at its
      // declaration -- the sibling case that a subtree-scoped fix misses.
      'export type Boxed<T> = T extends Array<infer E> ? Keys<E> : never;',
      // two infers in one clause, and a nominal type beside them
      'export type Fn<T> = T extends (a: infer A, b: infer B) => unknown',
      '  ? [A, B, Date]',
      '  : never;',
      // a mapped type nested inside a conditional's branch
      'export type Both<T> = T extends object ? { [P in keyof T]: T[P] } : T;',
    ].join('\n'),
  });

  const references = relation(outputDir, 'all-typescript-type-references.csv');
  const parameters = new Map(relation(outputDir, 'all-typescript-type-parameters.csv')
    .map((r) => [r.tsTypeParameterUniqueHash ?? '', r]));
  const failures: string[] = [];

  // Names that are parameters wherever they appear in the fixture, and the
  // owner each must resolve to. Nothing else in the fixture shares these names.
  const mustBeVariables = new Map<string, string>([
    ['K', 'MAPPED_TYPE'],
    ['P', 'MAPPED_TYPE'],
    ['U', 'INFER_TYPE'],
    ['E', 'INFER_TYPE'],
    ['A', 'INFER_TYPE'],
    ['B', 'INFER_TYPE'],
  ]);
  // …and a name that must stay nominal, so a fix that calls everything a
  // variable cannot pass by being indiscriminate.
  const mustBeReferences = new Set(['Date', 'Promise', 'Array']);

  // The `infer U` NODE emits its own row with kind INFER, and that is right:
  // it is the declaration, not a use of it. So the assertion is that a name
  // has a linked TYPE_VARIABLE row and NO TYPE_REFERENCE row -- not that its
  // every row is TYPE_VARIABLE, which would forbid the declaration itself.
  const seen = new Set<string>();
  for (const row of references) {
    const name = row.typeVariableName || row.typeName || '';
    const expectedOwner = mustBeVariables.get(name);
    if (expectedOwner !== undefined) {
      if (row.kind === 'INFER') {
        continue;
      }
      if (row.kind !== 'TYPE_VARIABLE') {
        failures.push(`${name} at line ${row.startLine} is ${row.kind}, not TYPE_VARIABLE ` +
          '— a parameter declared inside a type read as a nominal type');
        continue;
      }
      seen.add(name);
      const declaration = parameters.get(row.typeParameterLinkHash ?? '');
      if (!declaration) {
        failures.push(`${name} at line ${row.startLine} is TYPE_VARIABLE but links no ` +
          'declaration, so substitution has a name and no binding site');
        continue;
      }
      if (declaration.ownerKind !== expectedOwner) {
        failures.push(`${name} links an owner of kind ${declaration.ownerKind}, ` +
          `expected ${expectedOwner}`);
      }
      if (declaration.paramName !== name) {
        failures.push(`${name} links a parameter named ${declaration.paramName}`);
      }
    } else if (mustBeReferences.has(name) && row.kind !== 'TYPE_REFERENCE') {
      failures.push(`${name} at line ${row.startLine} is ${row.kind}: a nominal type was ` +
        'reclassified as a variable');
    }
  }

  for (const name of mustBeVariables.keys()) {
    if (!seen.has(name)) {
      failures.push(`${name} produced no linked TYPE_VARIABLE row at all`);
    }
  }

  cleanup();
  if (failures.length > 0) {
    return fail(failures.join('\n  '));
  }
  console.log(`  ${mustBeVariables.size} inner-declared parameters classified and linked; ` +
    `${mustBeReferences.size} nominal types left alone`);
  return 0;
}

// ---------------------------------------------------------------------------
// 31. Streaming writes the same file a whole-buffer write did
// ---------------------------------------------------------------------------

/**
 * Rows are written as extraction proceeds rather than accumulated, because
 * accumulating them is a ceiling: an 8,891-file single-program tree exhausted
 * a 4 GB heap and published TEN of twenty-one relations, which a consumer
 * cannot tell from a complete run. The same tree now finishes in 384 MB.
 *
 * Streaming has its own failure modes, and each assertion below is one of
 * them. They are cheap to check and silent when wrong:
 *
 *   ONE HEADER      a per-file writer that emits the header on every append
 *                   produces a file that loads and whose row count is wrong by
 *                   the number of files.
 *   EVERY RELATION  a relation nothing was appended to must still get its
 *                   file, or "no rows" reads as "the parser never ran".
 *   NO PARTIALS     the temp files must be renamed or removed, never left.
 *   COUNTS AGREE    the summary counts now come from the writer rather than
 *                   from an array, so they can drift from the file.
 *   ALL FILES       rows from the last file parsed must be present, which is
 *                   what a missing final flush would drop.
 */
async function streamedRelationsAreWellFormed(): Promise<number> {
  const files: Record<string, string> = { 'tsconfig.json': JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
    include: ['**/*.ts'],
  }) };
  // Enough files that a single-file test could not distinguish a per-file
  // header from a per-relation one.
  const FILE_COUNT = 12;
  for (let i = 0; i < FILE_COUNT; i += 1) {
    files[`m${i}.ts`] = [
      `export class C${i} {`,
      `  value: number = ${i};`,
      `  run(x: string): string { return x + this.value; }`,
      '}',
      `export function f${i}(): number { return new C${i}().value; }`,
    ].join('\n');
  }
  const { outputDir, cleanup } = await analyseInline('ts-stream-', files);
  const failures: string[] = [];

  const produced = fs.readdirSync(outputDir);
  const partials = produced.filter((f) => f.includes('.partial'));
  if (partials.length > 0) {
    failures.push(`temporary files were left behind: ${partials.join(', ')}`);
  }

  let relationsSeen = 0;
  for (const name of produced) {
    if (!name.endsWith('.csv')) {
      continue;
    }
    relationsSeen += 1;
    const text = fs.readFileSync(path.join(outputDir, name), 'utf-8');
    if (text === '') {
      continue;
    }
    const lines = text.split('\n').filter((l) => l !== '');
    const header = lines[0]!;
    const width = header.split('\t').length;
    const repeated = lines.slice(1).filter((l) => l === header).length;
    if (repeated > 0) {
      failures.push(`${name}: the header appears ${repeated + 1} times — it is being written `
        + 'per append rather than once per relation');
    }
    for (let i = 1; i < lines.length; i += 1) {
      const got = lines[i]!.split('\t').length;
      if (got !== width) {
        failures.push(`${name}: line ${i + 1} has ${got} field(s), header has ${width}`);
        break;
      }
    }
  }
  if (relationsSeen < 20) {
    failures.push(`only ${relationsSeen} relation file(s) were produced; every relation must get `
      + 'one so that "no rows" is distinguishable from "the parser never ran"');
  }

  // Every file's rows arrived, including the last -- a missing final flush
  // loses the tail and nothing else.
  const types = relation(outputDir, 'all-typescript-types.csv');
  const classNames = new Set(types.map((r) => r.name));
  for (let i = 0; i < FILE_COUNT; i += 1) {
    if (!classNames.has(`C${i}`)) {
      failures.push(`C${i} is missing: a file's rows were dropped`);
    }
  }

  cleanup();
  if (failures.length > 0) {
    return fail(failures.join('\n  '));
  }
  console.log(`  ${relationsSeen} relations, ${FILE_COUNT} files: one header each, no partials, `
    + 'every file\'s rows present');
  return 0;
}

// ---------------------------------------------------------------------------
// 32. The streamed read-back still catches a torn row
// ---------------------------------------------------------------------------

/**
 * The read-back is what makes "no torn row is ever published" a promise rather
 * than an assertion over the parser's own fixtures. Streaming forced it to
 * stop reading the file into one string -- a large relation exceeds V8's
 * maximum string length, so the old check would throw on a file that is in
 * fact well formed -- and a chunked reader has two failure modes of its own.
 *
 * A MULTI-BYTE character straddling a chunk boundary must not be decoded as
 * two halves, which would report a torn row in an intact file. And a line
 * break that only a CONSUMER recognises -- Python's `str.splitlines()` breaks
 * on U+2028, `split('\n')` does not -- must still be seen, because that
 * disagreement once let the parser certify a file its reader called torn.
 */
async function streamedVerificationCatchesTornRows(): Promise<number> {
  const failures: string[] = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-verify-'));
  const header = 'a\tb\tc';
  const check = (name: string, body: string): string | undefined => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, body);
    try {
      verifyRelationFileStreaming(file, file, header);
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  };

  // Big enough to cross the 1 MiB chunk boundary many times over, with a
  // multi-byte character in every row so a boundary must land inside one.
  const wide = `${header}\n${'1\t\u00e9\u4e2d\u1f600-padding-value\t3\n'.repeat(60_000)}`;
  const wideError = check('wide.csv', wide);
  if (wideError !== undefined) {
    failures.push(`a well-formed ${(wide.length / 1024 / 1024).toFixed(1)} MB file was rejected: `
      + `${wideError} — a multi-byte character was split across a chunk boundary`);
  }

  if (check('short.csv', `${header}\n1\t2\n`) === undefined) {
    failures.push('a row with too FEW fields was accepted');
  }
  if (check('long.csv', `${header}\n1\t2\t3\t4\n`) === undefined) {
    failures.push('a row with too MANY fields was accepted');
  }
  if (check('truncated.csv', `${header}\n1\t2\t3`) === undefined) {
    failures.push('a file not ending in a newline was accepted, so a truncated last row passes');
  }
  // The row is three fields to JavaScript and two rows to a consumer that
  // breaks on U+2028. Splitting the consumer's way is what catches it.
  if (check('sep.csv', `${header}\n1\t2\u20283\t4\n`) === undefined) {
    failures.push('a value carrying U+2028 was accepted: the parser would certify a file its '
      + 'consumer reads as torn');
  }
  // Well-formed rows AFTER a torn one must not mask it.
  if (check('late.csv', `${header}\n1\t2\t3\n1\t2\n1\t2\t3\n`) === undefined) {
    failures.push('a torn row in the MIDDLE of a file was accepted');
  }

  fs.rmSync(directory, { recursive: true, force: true });
  if (failures.length > 0) {
    return fail(failures.join('\n  '));
  }
  console.log('  a multi-MB well-formed file passes; short, long, truncated, U+2028 and '
    + 'mid-file tears all rejected');
  return 0;
}

// ---------------------------------------------------------------------------
// 33. Every program is extracted, and programs are not merged
// ---------------------------------------------------------------------------

/**
 * A discovered project is not one program. A monorepo root's tsconfig claims
 * only the files at the top, and every package below it is a separate program
 * with its own global scope — so analysing the root alone reached 24 of 965
 * files on one real repository, and the other 941 were extracted by nothing.
 *
 * Two things have to hold at once here, and they pull against each other.
 *
 *   EVERY PROGRAM IS EXTRACTED, into one flat relation set, as Java's
 *   multi-project run produces. That is the fix.
 *
 *   THE PROGRAMS ARE STILL SEPARATE, which merging the OUTPUT must not
 *   undo. The module link passes run within one program, so an import in
 *   program B must NOT resolve to an ambient module declared in program A.
 *   Running those passes across the merged facts would link them, and that is
 *   precisely the global-scope merge `tsc` does not do. A test that only
 *   counted rows would pass while this was broken.
 */
async function everyProgramIsExtractedAndNoneAreMerged(): Promise<number> {
  const tsconfig = JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
    include: ['**/*.ts'],
  });
  const { outputDir, cleanup } = await analyseProgramsInline('ts-progs-', {
    // the root program, which claims only what is beside it
    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
      include: ['*.ts'],
    }),
    'root-only.ts': 'export class RootOnly { run(): number { return 1; } }',
    // program A declares an ambient module
    'packages/alpha/tsconfig.json': tsconfig,
    'packages/alpha/ambient.d.ts': 'declare module "shared-thing" { export function go(): void; }',
    'packages/alpha/uses.ts': [
      'import { go } from "shared-thing";',
      'export class AlphaOnly { run(): void { go(); } }',
    ].join('\n'),
    // program B imports the SAME specifier but declares nothing
    'packages/beta/tsconfig.json': tsconfig,
    'packages/beta/uses.ts': [
      'import { go } from "shared-thing";',
      'export class BetaOnly { run(): void { go(); } }',
    ].join('\n'),
  });

  const failures: string[] = [];
  const types = relation(outputDir, 'all-typescript-types.csv');
  const names = new Set(types.map((r) => r.name));
  for (const expected of ['RootOnly', 'AlphaOnly', 'BetaOnly']) {
    if (!names.has(expected)) {
      failures.push(`${expected} is missing — its program was never extracted`);
    }
  }

  // Merging the output must not merge the KEYS.
  const modules = relation(outputDir, 'all-typescript-modules.csv');
  const seen = new Map<string, number>();
  for (const row of modules) {
    const key = row.tsModuleUniqueHash ?? '';
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      failures.push(`ts_module primary key ${key} appears ${count} times across programs`);
    }
  }

  // The partition itself. Alpha declares `shared-thing`; beta does not, so
  // beta's import must resolve to nothing.
  const imports = relation(outputDir, 'all-typescript-imports.csv')
    .filter((r) => r.importedPath === 'shared-thing');
  if (imports.length < 2) {
    failures.push(`expected an import of "shared-thing" in both programs, found ${imports.length}`);
  }
  for (const row of imports) {
    const inAlpha = (row.filePath ?? '').includes('alpha');
    const linked = (row.resolvedModuleLinkHash ?? '') !== '';
    if (!inAlpha && linked) {
      failures.push(`${row.filePath}: an import resolved to an ambient module declared in `
        + 'ANOTHER program — the link passes crossed a program boundary and merged two '
        + 'global scopes');
    }
    if (inAlpha && !linked) {
      failures.push(`${row.filePath}: an import did NOT resolve to the ambient module declared `
        + 'in its OWN program, so the link passes are not running per program at all');
    }
  }

  cleanup();
  if (failures.length > 0) {
    return fail(failures.join('\n  '));
  }
  console.log(`  3 programs extracted into one flat set, ${modules.length} module row(s), `
    + 'keys unique; the ambient module resolves inside its own program and nowhere else');
  return 0;
}

// ---------------------------------------------------------------------------
// 34. strictBindCallApply is emitted RESOLVED, not as written
// ---------------------------------------------------------------------------

/**
 * `lib.es5.d.ts` declares `call`, `apply` and `bind` twice — on `Function`,
 * and again on `CallableFunction extends Function` with precise generic
 * signatures. Which one a call resolves to is decided by
 * `strictBindCallApply`, so a consumer without it has two correct-looking
 * candidates and no way to choose. Measured at 16 wrong answers across two
 * repositories before this column existed.
 *
 * RESOLVED is the entire value, and is what this asserts. `strict: true`
 * IMPLIES the flag, and `ts.parseJsonConfigFileContent` does not apply that
 * implication — it leaves the option `undefined` — so emitting the parsed
 * option would answer the question wrongly for exactly the projects that set
 * `strict` and nothing else, which is the common configuration.
 *
 * The third program is the one that stops the rule being written as `||`: an
 * explicit `false` beats an implying `strict: true`.
 */
async function strictBindCallApplyIsResolved(): Promise<number> {
  const program = (compilerOptions: Record<string, unknown>): string =>
    JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', ...compilerOptions },
      include: ['**/*.ts'],
    });
  const source = 'export function run(f: () => void): void { f.call(undefined); }';
  const { outputDir, cleanup } = await analyseProgramsInline('ts-sbca-', {
    // the root claims only what sits beside it
    'tsconfig.json': program({}),
    'root.ts': source,
    // implied by `strict`
    'implied/tsconfig.json': program({ strict: true }),
    'implied/a.ts': source,
    // individual strict flags do NOT imply it
    'partial/tsconfig.json': program({ strictNullChecks: true, strictFunctionTypes: true }),
    'partial/a.ts': source,
    // an explicit false beats an implying `strict: true`
    'override/tsconfig.json': program({ strict: true, strictBindCallApply: false }),
    'override/a.ts': source,
  });

  const expected = new Map<string, string>([
    ['root.ts', 'false'],
    ['implied/a.ts', 'true'],
    ['partial/a.ts', 'false'],
    ['override/a.ts', 'false'],
  ]);
  const failures: string[] = [];
  const modules = relation(outputDir, 'all-typescript-modules.csv');
  for (const [file, want] of expected) {
    const row = modules.find((r) => (r.filePath ?? '').replace(/\\/g, '/') === file);
    if (!row) {
      failures.push(`${file}: no ts_module row, so the program was not analysed`);
      continue;
    }
    const got = row.strictBindCallApply ?? '';
    if (got !== want) {
      const why = want === 'true'
        ? 'the `strict` implication was not applied, so the common configuration reads wrong'
        : 'a flag was reported set when the checker treats it as unset';
      failures.push(`${file}: strictBindCallApply is "${got}", expected "${want}" — ${why}`);
    }
  }

  cleanup();
  if (failures.length > 0) {
    return fail(failures.join('\n  '));
  }
  console.log('  resolved per program: implied by strict, not implied by individual strict '
    + 'flags, and an explicit false wins');
  return 0;
}

const CHECKS: Check[] = [
  { name: 'strictBindCallApply is emitted resolved', proves: 'the flag is emitted as the checker resolves it — implied by strict, not by individual strict flags, explicit false winning — so a consumer can pick between the Function and CallableFunction overloads of call/apply/bind', run: strictBindCallApplyIsResolved },
  { name: 'every program is extracted, none are merged', proves: 'each program under a root reaches one flat relation set with unique keys, while the module link passes stay inside a program so two global scopes are never merged', run: everyProgramIsExtractedAndNoneAreMerged },
  { name: 'streamed relations are well formed', proves: 'rows written as extraction proceeds produce one header per relation, a file for every relation, no leftover temporaries and no dropped tail', run: streamedRelationsAreWellFormed },
  { name: 'streamed read-back catches a torn row', proves: 'the chunked verifier accepts a multi-MB well-formed file and still rejects short, long, truncated, U+2028-bearing and mid-file tears', run: streamedVerificationCatchesTornRows },
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
  { name: 'JSX brace expressions are walked', proves: 'a call inside a JSX brace is an ordinary call site; only the component invocation is reserved', run: jsxBraceExpressionsWalked },
  { name: 'destructuring records its source', proves: 'a bound name carries the property or index it binds, so a renamed or positional binding is recoverable', run: destructuringRecordsItsSource },
  { name: 'no emitted value can split a row', proves: 'no value contains a character a consumer treats as a line break, so a row cannot tear', run: noValueCanSplitARow },
  { name: 'signatures link their return type', proves: 'a call through any callable shape reaches a result type, so a chain does not stop at it', run: signaturesLinkTheirReturnType },
  { name: 'kinds that were wrong once', proves: 'a row in the right place with the wrong kind is invisible to every count-based check', run: kindsThatWereWrongOnce },
  { name: 'overloads never name the implementation', proves: 'a call resolves to an overload signature, and a shape member with two signatures is not SOLE', run: overloadsNeverNameTheImplementation },
  { name: 'discovery follows the import closure', proves: 'a program is its roots plus everything they import, and nothing more', run: discoveryFollowsTheImportClosure },
  { name: 'pattern parameters bind names', proves: 'a destructured parameter emits the names it binds, so a call through one can resolve', run: patternParametersBindNames },
  { name: 'destructured names reach their value', proves: 'a bound name links the initializer it was destructured from, so a call through one can resolve', run: destructuredNamesReachTheirValue },
  { name: 'unresolved imports name their package', proves: 'a client-only run can say which packages to stage, without needing node_modules present', run: unresolvedImportsNameTheirPackage },
  { name: 'annotated declarations name their type', proves: 'a declared type is reachable as a row, not only readable as text, so type flow can be followed', run: annotatedDeclarationsNameTheirType },
  { name: 'type references name their entity', proves: 'a reference carries the written name without type arguments, so a scope lookup needs no string surgery', run: typeReferencesNameTheirEntity },
  { name: 'constrained type parameters name their bound', proves: 'a bound and a default are reachable as rows for every owner kind, type-level ones included', run: constrainedTypeParametersNameTheirBound },
  { name: 'parameters declared inside a type are variables', proves: 'a mapped `[K in …]` and an `infer U` are TYPE_VARIABLE and link their declaration, so substitution does not mistake them for nominal types', run: parametersDeclaredInsideATypeAreVariables },
  { name: 'type variables name their parameter', proves: 'a type-variable reference links the parameter that declares it, shadowing respected, so substitution has a starting point', run: typeVariablesNameTheirParameter },
  { name: 'object-literal members name their literal', proves: 'a literal member has an owner, so its parameters can be typed from the literal contextual annotation', run: objectLiteralMembersNameTheirLiteral },
  { name: 'row paths are self-consistent', proves: 'baseMservPath + filePath names the file, so a position join is sound and two packages cannot share a key', run: rowPathsAreSelfConsistent },
  { name: 'column order is append-only', proves: 'a column is never inserted mid-table, because Souffle binds by position and misbinds silently', run: columnOrderIsAppendOnly },
  { name: 'governing tsconfig is per file', proves: 'a file reachable from two programs mints ONE ts_module row, so no key carries contradictory moduleResolutionMode', run: governingConfigIsPerFile },
  { name: 'a decorator is descended once', proves: 'a callable inside a decorator argument is one ts_method, not two colliding on one key as a false overload set', run: decoratorDescendedOnce },
  { name: 'declaration extensions are whole extensions', proves: '`.d.cts` and `.d.mts` are single extensions, so no stem keeps a stray `.d`', run: declarationExtensionsAreWholeExtensions },
  { name: 'an annotation can declare a signature set', proves: 'a type literal holding several call signatures is resolved as the set it is, and arity picks the arm tsc picks', run: annotationCanDeclareASignatureSet },
  { name: 'object-literal keys reach the IR', proves: 'a property key is emitted as its own row, joinable to its value, never bound as a scope reference, and absent when computed', run: objectLiteralKeysReachTheIr },
  { name: 'empty imports record their module edge', proves: 'an import that binds nothing still emits a resolved row, so a package imported only for its ambient declarations can be staged', run: emptyImportsRecordTheirModuleEdge },
  { name: 'reopened type members share a group key', proves: 'a member of a declaration-merged type has one identity across files, so two signatures of it are overload siblings rather than a wrong answer', run: reopenedTypeMembersShareAGroupKey },
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
      rc = await c.run();
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
