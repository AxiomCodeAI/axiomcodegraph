/**
 * GRADLE TESTS — one file, mirroring python-tests.ts.
 *
 *     npx tsx src/test/gradle-tests.ts            # everything
 *     npx tsx src/test/gradle-tests.ts --list     # what runs, and what it proves
 *     npx tsx src/test/gradle-tests.ts --bless    # rewrite the goldens
 *
 * NO GRADLE, NO JVM, NO NETWORK. Every check runs the parser and compares the
 * result with expectations checked into src/test-data/gradle, so it works
 * anywhere the project builds.
 *
 * ## What this suite can and cannot do
 *
 * It can detect drift. It cannot authorise it. The goldens here were produced
 * by this parser, so they encode what it currently does — which is exactly the
 * failure mode the README warns about: a fixture and the code that produced it
 * share a premise, and a shared premise makes both agree on the same mistake.
 *
 * Two things push back on that.
 *
 * The behavioural checks below are written from the Gradle DSL's documented
 * semantics rather than from parser output. `include` is a method on Settings
 * and a CopySpec filter elsewhere; a version catalog alias maps to an accessor
 * by replacing `-` and `_` with `.`; a `def` is script-local. Those hold
 * whatever this parser happens to emit, and each one here caught a real defect
 * when it was written.
 *
 * The rest needs Gradle itself, which is the only authority on what a build
 * file means. That gate lives in gradle-gates/diff-gradle-model.ts and skips
 * when no Gradle is on the path — see CONTRIBUTING-gradle.md for what it
 * covers and what remains ungraded.
 */
import * as fs from 'fs';
import * as path from 'path';

import { GradleCatalogEntry } from '@/analysis-types/gradle/GradleCatalogEntry';
import { extractProject } from '@/extract';
import { GradleProjectAnalyzer } from '@/workflows/gradle/gradle-project-analyzer';

const DATA = 'src/test-data/gradle';
const GOLDEN = path.join(DATA, '_golden');
const BLESS = process.argv.includes('--bless');

/** Columns that cannot be compared across runs or machines. */
const VOLATILE = /^(baseMservPath|filePath)$/;

/**
 * Hash columns are dropped from the golden comparison.
 *
 * They are content-addressed over an absolute path, so they differ on every
 * machine, and keeping them would make the goldens unusable for anyone but
 * their author. Referential integrity is what actually checks them, and it
 * checks something stronger: that every foreign key resolves to a row that
 * exists, which a textual comparison of opaque digests never could.
 */
const HASH_COLUMN = /(Hash|hash)$/;

type Row = Record<string, string>;

// ---------------------------------------------------------------------------
// shared machinery
// ---------------------------------------------------------------------------

function tsv(dir: string, file: string): Row[] {
  const fp = path.join(dir, file);
  if (!fs.existsSync(fp)) return [];
  const lines = fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0]!.split('\t');
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])) as Row;
  });
}

async function analyse(rootDir: string, outputDir: string): Promise<string> {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const silence = console.log;
  console.log = () => {};
  try {
    await new GradleProjectAnalyzer(outputDir).analyzeGradleFiles(
      [{ name: path.basename(rootDir), path: rootDir, language: 'UNKNOWN' as never, hasSourceFiles: false }],
      'GRADLE_FIXTURE_VERSION'
    );
  } finally {
    console.log = silence;
  }
  return outputDir;
}

/** Every fact, sorted, volatile and hash columns dropped. Row order is not a contract. */
function snapshot(out: string): Map<string, string[]> {
  const snap = new Map<string, string[]>();
  for (const f of fs.readdirSync(out).filter((x) => x.startsWith('all-gradle-'))) {
    const rows = tsv(out, f);
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]!).filter((c) => !VOLATILE.test(c) && !HASH_COLUMN.test(c));
    snap.set(
      f.replace('all-gradle-', '').replace('.csv', ''),
      rows.map((r) => cols.map((c) => `${c}=${r[c] ?? ''}`).join('\t')).sort()
    );
  }
  return snap;
}

interface Check { name: string; proves: string; run: (out: string) => number }
const fail = (m: string): number => { console.log('  ✗ ' + m); return 1; };

// ---------------------------------------------------------------------------
// 1. golden facts — detects drift, cannot authorise it
// ---------------------------------------------------------------------------

function goldenCheck(fixture: string): Check {
  return {
    name: `golden:${fixture}`,
    proves: `every emitted row for ${fixture} matches the committed expectation`,
    run: (out) => {
      const snap = snapshot(out);
      const goldenDir = path.join(GOLDEN, fixture);

      if (BLESS) {
        fs.rmSync(goldenDir, { recursive: true, force: true });
        fs.mkdirSync(goldenDir, { recursive: true });
        for (const [rel, rows] of snap) {
          fs.writeFileSync(path.join(goldenDir, rel + '.txt'), rows.join('\n') + '\n');
        }
        console.log(`  ✎ blessed ${snap.size} relation(s)`);
        return 0;
      }

      if (!fs.existsSync(goldenDir)) return fail(`no golden for ${fixture}; run --bless`);

      let bad = 0;
      const expectedFiles = new Set(fs.readdirSync(goldenDir).map((f) => f.replace('.txt', '')));

      for (const rel of expectedFiles) {
        if (!snap.has(rel)) { bad += fail(`relation ${rel} vanished from ${fixture}`); continue; }
      }
      for (const [rel, rows] of snap) {
        if (!expectedFiles.has(rel)) { bad += fail(`relation ${rel} appeared unexpectedly in ${fixture}`); continue; }
        const want = fs.readFileSync(path.join(goldenDir, rel + '.txt'), 'utf-8').split('\n').filter(Boolean);
        if (want.length !== rows.length) {
          bad += fail(`${rel}: ${rows.length} rows, expected ${want.length}`);
        }
        for (let i = 0; i < Math.min(want.length, rows.length); i++) {
          if (want[i] !== rows[i]) {
            bad += fail(`${rel} row ${i}\n      want ${want[i]}\n      got  ${rows[i]}`);
            break;
          }
        }
      }
      return bad;
    },
  };
}

// ---------------------------------------------------------------------------
// 2. column arity — the schema is a contract, and a shifted column is silent
// ---------------------------------------------------------------------------

const arityCheck: Check = {
  name: 'arity',
  proves: 'every row has exactly as many fields as its header, and the key column is last',
  run: (out) => {
    let bad = 0;
    for (const f of fs.readdirSync(out).filter((x) => x.startsWith('all-gradle-'))) {
      const lines = fs.readFileSync(path.join(out, f), 'utf-8').split('\n').filter(Boolean);
      if (!lines.length) continue;
      const header = lines[0]!.split('\t');

      const last = header[header.length - 1]!;
      if (!/UniqueHash$/.test(last)) {
        bad += fail(`${f}: last column is ${last}, expected the row's own key`);
      }

      lines.slice(1).forEach((line, i) => {
        const n = line.split('\t').length;
        if (n !== header.length) {
          bad += fail(`${f} row ${i}: ${n} fields, header has ${header.length}`);
        }
      });
    }
    return bad;
  },
};

// ---------------------------------------------------------------------------
// 3. referential integrity — every foreign key resolves, or is empty
// ---------------------------------------------------------------------------

/**
 * Absence is meaningful, so an empty foreign key is legal everywhere: it is
 * how the parser says "this could not be decided". What is never legal is a
 * NON-empty key pointing at a row that does not exist, which is a fabricated
 * edge and strictly worse than no edge at all.
 */
const integrityCheck: Check = {
  name: 'integrity',
  proves: 'every non-empty foreign key resolves to a row that exists',
  run: (out) => {
    const files = fs.readdirSync(out).filter((x) => x.startsWith('all-gradle-'));
    const rowsByFile = new Map(files.map((f) => [f, tsv(out, f)]));

    // Every primary key in the run, by prefix.
    const known = new Set<string>();
    for (const rows of rowsByFile.values()) {
      for (const r of rows) {
        for (const [col, value] of Object.entries(r)) {
          if (/UniqueHash$/.test(col) && value) known.add(value);
        }
      }
    }

    // serviceVersionLinkHash is a stamp, not an edge into these relations.
    const NOT_A_FOREIGN_KEY = /^(serviceVersionLinkHash|.*UniqueHash)$/;

    let bad = 0;
    let checked = 0;
    for (const [file, rows] of rowsByFile) {
      for (const [i, r] of rows.entries()) {
        for (const [col, value] of Object.entries(r)) {
          if (!/Hash$/.test(col) || NOT_A_FOREIGN_KEY.test(col)) continue;
          if (!value) continue; // an undecided link is legal and meaningful
          checked++;
          if (!known.has(value)) {
            bad += fail(`${file} row ${i}: ${col}=${value.slice(0, 24)}… points at no row`);
            if (bad > 5) return bad;
          }
        }
      }
    }
    if (!bad) console.log(`  ${checked} foreign keys, all resolved`);
    return bad;
  },
};

// ---------------------------------------------------------------------------
// 4. behaviour — written from Gradle's documented semantics, not from output
// ---------------------------------------------------------------------------

const behaviourChecks: Check[] = [
  {
    name: 'kts-is-discovered',
    proves: '.gradle.kts files are found at all — the old scan matched only .gradle',
    run: (out) => {
      const scripts = tsv(out, 'all-gradle-scripts.csv');
      const kts = scripts.filter((s) => s['fileName']?.endsWith('.kts'));
      return kts.length >= 2 ? 0 : fail(`found ${kts.length} Kotlin DSL scripts, expected at least 2`);
    },
  },
  {
    name: 'catalog-accessor-mapping',
    proves: "Gradle's alias rule: '-' and '_' become '.' in the generated accessor",
    run: (out) => {
      const entries = tsv(out, 'all-gradle-catalog-entries.csv');
      let bad = 0;
      for (const e of entries) {
        const want = GradleCatalogEntry.toAccessorPath(e['alias'] ?? '');
        if (e['accessorPath'] !== want) {
          bad += fail(`alias ${e['alias']} → accessor ${e['accessorPath']}, expected ${want}`);
        }
      }
      if (!entries.some((e) => (e['alias'] ?? '').includes('-'))) {
        bad += fail('no hyphenated alias in the fixture — the rule is untested');
      }
      return bad;
    },
  },
  {
    name: 'catalog-dangling-ref-stays-empty',
    proves: 'a version.ref naming nothing leaves resolvedVersion empty, not echoed back',
    run: (out) => {
      const e = tsv(out, 'all-gradle-catalog-entries.csv').find((x) => x['alias'] === 'dangling-ref');
      if (!e) return fail('dangling-ref entry missing from the fixture output');
      if (e['versionRef'] !== 'does-not-exist') return fail(`versionRef=${e['versionRef']}`);
      return e['resolvedVersion'] === '' ? 0 : fail(`resolvedVersion=${e['resolvedVersion']}, expected empty`);
    },
  },
  {
    name: 'catalog-accessor-resolves-to-coordinate',
    proves: 'libs.spring.boot.starter.web reaches the TOML entry and gains a real coordinate',
    run: (out) => {
      const c = tsv(out, 'all-gradle-dependency-coordinates.csv')
        .find((x) => x['catalogAlias'] === 'spring.boot.starter.web');
      if (!c) return fail('no coordinate carrying the spring.boot.starter.web accessor');
      let bad = 0;
      if (c['group'] !== 'org.springframework.boot') bad += fail(`group=${c['group']}`);
      if (c['artifact'] !== 'spring-boot-starter-web') bad += fail(`artifact=${c['artifact']}`);
      if (c['resolvedVersion'] !== '3.2.2') bad += fail(`resolvedVersion=${c['resolvedVersion']}, expected 3.2.2`);
      if (c['versionSource'] !== 'CATALOG') bad += fail(`versionSource=${c['versionSource']}`);
      if (!c['catalogEntryHash']) bad += fail('catalogEntryHash empty — the join did not happen');
      return bad;
    },
  },
  {
    name: 'include-only-in-settings',
    proves: "`include` declares a project in settings and filters filenames elsewhere",
    run: (out) => {
      const scripts = new Map(tsv(out, 'all-gradle-scripts.csv').map((s) => [s['gradleScriptUniqueHash'], s]));
      let bad = 0;
      for (const d of tsv(out, 'all-gradle-declarations.csv')) {
        if (d['declarationType'] !== 'INCLUDE') continue;
        const kind = scripts.get(d['scriptHash'] ?? '')?.['scriptKind'];
        if (kind !== 'SETTINGS' && kind !== 'BUILD_SRC_SETTINGS') {
          bad += fail(`INCLUDE '${d['name']}' emitted from a ${kind} script`);
        }
        if (!(d['name'] ?? '').startsWith(':')) {
          bad += fail(`INCLUDE '${d['name']}' is not a canonical project path`);
        }
      }
      return bad;
    },
  },
  {
    name: 'include-resolves-to-subproject',
    proves: "include 'core' links to core/build.gradle and gives it the path :core",
    run: (out) => {
      const scripts = new Map(tsv(out, 'all-gradle-scripts.csv').map((s) => [s['gradleScriptUniqueHash'], s]));
      const inc = tsv(out, 'all-gradle-declarations.csv')
        .find((d) => d['declarationType'] === 'INCLUDE' && d['name'] === ':core');
      if (!inc) return fail("no INCLUDE row for ':core' — colon-less form not normalised?");
      if (!inc['resolvedTargetHash']) return fail("include ':core' did not resolve to a script");
      const target = scripts.get(inc['resolvedTargetHash']);
      if (!target) return fail('resolvedTargetHash points at no script');
      let bad = 0;
      if (target['gradleProjectPath'] !== ':core') bad += fail(`target path=${target['gradleProjectPath']}`);
      if (target['scriptKind'] !== 'PROJECT_BUILD') bad += fail(`target kind=${target['scriptKind']}`);
      return bad;
    },
  },
  {
    name: 'buildsrc-is-not-a-product-project',
    proves: 'buildSrc builds the build; its dependencies are not product dependencies',
    run: (out) => {
      const s = tsv(out, 'all-gradle-scripts.csv').find((x) => x['relativePath']?.includes('buildSrc'));
      if (!s) return fail('buildSrc script not discovered');
      let bad = 0;
      if (s['scriptKind'] !== 'BUILD_SRC_BUILD') bad += fail(`kind=${s['scriptKind']}`);
      if (s['gradleProjectPath'] !== '') bad += fail(`buildSrc claims project path ${s['gradleProjectPath']}`);
      return bad;
    },
  },
  {
    name: 'local-def-does-not-escape-its-script',
    proves: 'a `def` is script-local, so it never resolves a reference in another file',
    run: (out) => {
      const decl = tsv(out, 'all-gradle-declarations.csv')
        .find((d) => d['declarationType'] === 'PROPERTY' && d['name'] === 'localOnly');
      if (!decl) return fail('localOnly property not extracted');
      if (decl['qualifier'] !== 'LOCAL_VARIABLE') return fail(`scope=${decl['qualifier']}`);
      const leaked = tsv(out, 'all-gradle-value-references.csv')
        .some((r) => r['resolvedContext'] === decl['gradleDeclarationUniqueHash']
          && r['scriptHash'] !== decl['scriptHash']);
      return leaked ? fail('a reference in another script resolved to a local def') : 0;
    },
  },
  {
    name: 'ext-scope-is-distinguished',
    proves: 'ext { } properties are marked EXT_BLOCK, not PROJECT',
    run: (out) => {
      const decls = tsv(out, 'all-gradle-declarations.csv');
      const guava = decls.find((d) => d['name'] === 'guavaVersion');
      const group = decls.find((d) => d['name'] === 'group' && d['declarationType'] === 'PROPERTY');
      let bad = 0;
      if (guava?.['qualifier'] !== 'EXT_BLOCK') bad += fail(`guavaVersion scope=${guava?.['qualifier']}`);
      if (group?.['qualifier'] !== 'PROJECT') bad += fail(`group scope=${group?.['qualifier']}`);
      return bad;
    },
  },
  {
    name: 'coordinate-splitting',
    proves: 'group:artifact:version:classifier@ext splits into its five parts',
    run: (out) => {
      const c = tsv(out, 'all-gradle-dependency-coordinates.csv')
        .find((x) => x['artifact'] === 'h2');
      if (!c) return fail('h2 coordinate not found');
      let bad = 0;
      if (c['group'] !== 'com.h2database') bad += fail(`group=${c['group']}`);
      if (c['version'] !== '2.2.224') bad += fail(`version=${c['version']}`);
      if (c['classifier'] !== 'tests') bad += fail(`classifier=${c['classifier']}`);
      if (c['extension'] !== 'jar') bad += fail(`extension=${c['extension']}`);
      return bad;
    },
  },
  {
    name: 'absent-version-is-not-unknown',
    proves: 'a BOM-managed coordinate reports ABSENT, distinct from an unread version',
    run: (out) => {
      const c = tsv(out, 'all-gradle-dependency-coordinates.csv')
        .find((x) => x['artifact'] === 'spring-core' && x['notation'] === 'STRING_NOTATION');
      if (!c) return fail('spring-core (BOM-managed) coordinate not found');
      if (c['version'] !== '') return fail(`version=${c['version']}, expected empty`);
      return c['versionSource'] === 'ABSENT' ? 0 : fail(`versionSource=${c['versionSource']}`);
    },
  },
  {
    name: 'files-notation-is-one-row-per-artifact',
    proves: "files('a.jar','b.jar') is one declaration and two coordinates",
    run: (out) => {
      const rows = tsv(out, 'all-gradle-dependency-coordinates.csv')
        .filter((x) => x['notation'] === 'FILES');
      const specs = new Set(rows.map((r) => r['fileSpec']));
      if (!specs.has('libs/legacy.jar') || !specs.has('libs/extra.jar')) {
        return fail(`fileSpecs = ${[...specs].join(', ')}`);
      }
      return 0;
    },
  },
  {
    name: 'external-vs-unresolved-are-split',
    proves: 'System.getenv is EXTERNAL, not counted against resolution coverage',
    run: (out) => {
      const refs = tsv(out, 'all-gradle-value-references.csv');
      const env = refs.find((r) => r['referenceType'] === 'ENV_VARIABLE');
      if (!env) return fail('no ENV_VARIABLE reference extracted');
      if (env['resolutionKind'] !== 'EXTERNAL') return fail(`resolutionKind=${env['resolutionKind']}`);
      if (env['resolvedContext'] !== '') return fail('EXTERNAL reference carries a target hash');
      const interpolated = refs.find((r) => r['referenceExpression'] === 'guavaVersion');
      if (!interpolated) return fail('the ${guavaVersion} reference was not extracted');
      return /PROPERTY$/.test(interpolated['resolutionKind'] ?? '') ? 0
        : fail(`guavaVersion resolutionKind=${interpolated['resolutionKind']}`);
    },
  },
  {
    name: 'lossy-rewrites-leave-a-gap',
    proves: 'a construct the grammar cannot read is recorded, never silently dropped',
    run: (out) => {
      const gaps = tsv(out, 'all-gradle-parse-gaps.csv');
      const reasons = new Set(gaps.map((g) => g['reason']));
      let bad = 0;
      for (const want of ['DROPPED_CLOSURE_PARAMETERS', 'REWRITTEN_ELVIS', 'REPLACED_NON_ASCII']) {
        if (!reasons.has(want)) bad += fail(`no ${want} gap from the preprocessor fixture`);
      }
      for (const g of gaps) {
        if (Number(g['startLine']) < 1) bad += fail(`gap has startLine ${g['startLine']}`);
      }
      return bad;
    },
  },
  {
    name: 'parse-status-matches-gap-count',
    proves: 'a script reporting OK really produced no gaps, so empty means empty',
    run: (out) => {
      const gapsByScript = new Map<string, number>();
      for (const g of tsv(out, 'all-gradle-parse-gaps.csv')) {
        const k = g['scriptHash'] ?? '';
        gapsByScript.set(k, (gapsByScript.get(k) ?? 0) + 1);
      }
      let bad = 0;
      for (const s of tsv(out, 'all-gradle-scripts.csv')) {
        const actual = gapsByScript.get(s['gradleScriptUniqueHash'] ?? '') ?? 0;
        if (Number(s['parseGapCount']) !== actual) {
          bad += fail(`${s['fileName']}: parseGapCount=${s['parseGapCount']} but ${actual} gap rows`);
        }
        if (s['parseStatus'] === 'OK' && actual > 0) {
          bad += fail(`${s['fileName']} reports OK with ${actual} gaps`);
        }
      }
      return bad;
    },
  },
  {
    name: 'block-counts-are-direct-children',
    proves: 'childBlockCount counts direct children only, so summing does not double count',
    run: (out) => {
      const blocks = tsv(out, 'all-gradle-blocks.csv');
      const decls = tsv(out, 'all-gradle-declarations.csv');
      let bad = 0;
      for (const b of blocks) {
        const key = b['gradleBlockUniqueHash'];
        const kids = blocks.filter((x) => x['parentBlockHash'] === key).length;
        const owned = decls.filter((x) => x['parentBlockHash'] === key).length;
        if (Number(b['childBlockCount']) !== kids) {
          bad += fail(`block ${b['blockName']}: childBlockCount=${b['childBlockCount']}, actual ${kids}`);
        }
        if (Number(b['declarationCount']) !== owned) {
          bad += fail(`block ${b['blockName']}: declarationCount=${b['declarationCount']}, actual ${owned}`);
        }
        if (bad > 3) return bad;
      }
      return bad;
    },
  },
  {
    name: 'block-tree-is-acyclic',
    proves: 'the parent chain terminates, so a downstream traversal cannot hang',
    run: (out) => {
      const blocks = tsv(out, 'all-gradle-blocks.csv');
      const byHash = new Map(blocks.map((b) => [b['gradleBlockUniqueHash'], b]));
      let bad = 0;
      for (const b of blocks) {
        const seen = new Set<string>();
        let cur: string | undefined = b['gradleBlockUniqueHash'];
        while (cur) {
          if (seen.has(cur)) { bad += fail(`cycle through block ${b['blockName']}`); break; }
          seen.add(cur);
          cur = byHash.get(cur)?.['parentBlockHash'] || undefined;
        }
        if (bad) break;
      }
      return bad;
    },
  },
  {
    name: 'keys-are-unique',
    proves: 'no two rows in a relation share a primary key',
    run: (out) => {
      let bad = 0;
      for (const f of fs.readdirSync(out).filter((x) => x.startsWith('all-gradle-'))) {
        const rows = tsv(out, f);
        if (!rows.length) continue;
        const keyCol = Object.keys(rows[0]!).find((c) => /UniqueHash$/.test(c));
        if (!keyCol) continue;
        const seen = new Map<string, number>();
        rows.forEach((r, i) => {
          const k = r[keyCol] ?? '';
          if (seen.has(k)) {
            bad += fail(`${f}: rows ${seen.get(k)} and ${i} share a key (${r['name'] ?? r['blockName'] ?? ''})`);
          } else seen.set(k, i);
        });
        if (bad > 3) return bad;
      }
      return bad;
    },
  },
  {
    name: 'commented-out-code-is-flagged-not-extracted',
    proves: 'a commented dependency is a comment, never a declaration',
    run: (out) => {
      const comments = tsv(out, 'all-gradle-comments.csv');
      const flagged = comments.filter((c) => c['isCommentedOutCode'] === 'true');
      if (!flagged.length) return fail('the commented-out dependency was not flagged');
      const leaked = tsv(out, 'all-gradle-dependency-coordinates.csv')
        .some((c) => c['artifact'] === 'removed');
      return leaked ? fail('a commented-out dependency became a real coordinate') : 0;
    },
  },
  {
    name: 'repository-url-is-captured',
    proves: "maven { url '...' } produces a REPOSITORY row, not just an anonymous block",
    run: (out) => {
      const repo = tsv(out, 'all-gradle-declarations.csv')
        .find((d) => d['declarationType'] === 'REPOSITORY' && d['notation'] === 'MAVEN_CUSTOM');
      if (!repo) return fail('no MAVEN_CUSTOM repository row');
      return repo['name'] === 'https://repo.spring.io/milestone' ? 0 : fail(`name=${repo['name']}`);
    },
  },
  {
    name: 'tasks-are-declarations',
    proves: 'TASK and GradleTaskStyle are actually emitted — both were dead columns',
    run: (out) => {
      const tasks = tsv(out, 'all-gradle-declarations.csv').filter((d) => d['declarationType'] === 'TASK');
      if (!tasks.length) return fail('no TASK declarations emitted');
      const styles = new Set(tasks.map((t) => t['notation']));
      let bad = 0;
      if (!styles.has('TASK_KEYWORD')) bad += fail(`no TASK_KEYWORD; styles seen: ${[...styles].join(', ')}`);
      if (![...styles].some((s) => (s ?? '').startsWith('TASKS_REGISTER'))) {
        bad += fail(`no TASKS_REGISTER style; styles seen: ${[...styles].join(', ')}`);
      }
      return bad;
    },
  },
  {
    name: 'malformed-catalog-line-is-a-gap',
    proves: 'an unparseable catalog line is recorded rather than skipped in silence',
    run: (out) => {
      const gaps = tsv(out, 'all-gradle-parse-gaps.csv')
        .filter((g) => g['nodeType'] === 'catalog_entry');
      if (!gaps.length) return fail('the malformed catalog line produced no gap');
      const unknownTable = tsv(out, 'all-gradle-catalog-entries.csv')
        .some((e) => e['alias'] === 'ignored');
      return unknownTable ? fail('an entry from an unknown table was emitted') : 0;
    },
  },
];

// ---------------------------------------------------------------------------
// 5. the entry point — the path a caller actually uses
// ---------------------------------------------------------------------------

/**
 * Everything above drives GradleProjectAnalyzer directly, which is not how the
 * parser is used. `extractProject()` runs project detection first and hands
 * the analyzer a list of scan targets that OVERLAP: the repository root is
 * prepended so root-level config is never missed, and every detected project
 * underneath it is added as well.
 *
 * That overlap is invisible to a test that constructs its own single target,
 * and it broke three things at once — every file analysed twice, one build
 * script emitted as both PROJECT_BUILD and SCRIPT_PLUGIN, and the duplicate
 * rows carrying different `baseMservPath` values so they had different keys
 * and slipped past the uniqueness check.
 *
 * So these run the real entry point, over a fixture shaped like the case that
 * triggers it: a directory that is not itself a project, holding two that are.
 */
async function analyseViaEntryPoint(rootDir: string, outputDir: string): Promise<string> {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const silence = console.log;
  console.log = () => {};
  try {
    await extractProject({
      projectPath: rootDir,
      versionLink: 'GRADLE_ENTRY_POINT_TEST',
      excludeTests: false,
      outputDir,
    });
  } finally {
    console.log = silence;
  }
  return outputDir;
}

const entryPointChecks: Check[] = [
  {
    name: 'entry:gradle-is-detected-automatically',
    proves: 'extractProject finds the Gradle builds with no Gradle-specific configuration',
    run: (out) => {
      const scripts = tsv(out, 'all-gradle-scripts.csv');
      if (!scripts.length) return fail('extractProject emitted no Gradle scripts at all');
      const names = new Set(scripts.map((s) => s['fileName']));
      let bad = 0;
      for (const want of ['settings.gradle', 'build.gradle', 'build.gradle.kts']) {
        if (!names.has(want)) bad += fail(`${want} was not discovered through the entry point`);
      }
      return bad;
    },
  },
  {
    name: 'entry:each-file-produces-exactly-one-script',
    proves: 'overlapping scan targets do not analyse the same file twice',
    run: (out) => {
      const scripts = tsv(out, 'all-gradle-scripts.csv');
      const byPath = new Map<string, number>();
      for (const s of scripts) {
        const p = s['filePath'] ?? '';
        byPath.set(p, (byPath.get(p) ?? 0) + 1);
      }
      let bad = 0;
      for (const [p, n] of byPath) {
        if (n > 1) bad += fail(`${path.basename(p)} produced ${n} script rows`);
      }
      return bad;
    },
  },
  {
    name: 'entry:one-file-one-classification',
    proves: 'a build script is not both PROJECT_BUILD and SCRIPT_PLUGIN',
    run: (out) => {
      const kinds = new Map<string, Set<string>>();
      for (const s of tsv(out, 'all-gradle-scripts.csv')) {
        const p = s['filePath'] ?? '';
        if (!kinds.has(p)) kinds.set(p, new Set());
        kinds.get(p)!.add(s['scriptKind'] ?? '');
      }
      let bad = 0;
      for (const [p, set] of kinds) {
        if (set.size > 1) bad += fail(`${path.basename(p)} classified as ${[...set].join(' and ')}`);
      }
      return bad;
    },
  },
  {
    name: 'entry:no-duplicate-facts',
    proves: 'no relation gains duplicate rows from the overlap',
    run: (out) => {
      let bad = 0;
      for (const f of fs.readdirSync(out).filter((x) => x.startsWith('all-gradle-'))) {
        const rows = tsv(out, f);
        if (!rows.length) continue;
        // Compare on content rather than key: the duplicate rows the overlap
        // produced differed in baseMservPath, so their KEYS differed and a
        // uniqueness check saw nothing wrong. Identity is the file plus the
        // position, which is what a reader would call the same fact.
        const seen = new Set<string>();
        for (const r of rows) {
          const id = [r['filePath'], r['startLine'], r['startColumn'], r['name'] ?? r['blockName'] ?? r['alias'] ?? '', r['declarationType'] ?? r['blockType'] ?? ''].join('|');
          if (seen.has(id)) { bad += fail(`${f}: duplicate fact ${id.slice(0, 90)}`); break; }
          seen.add(id);
        }
      }
      return bad;
    },
  },
  {
    name: 'entry:kotlin-and-groovy-both-yield-coordinates',
    proves: 'both dialects survive the real entry point, including one-line blocks',
    run: (out) => {
      const coords = tsv(out, 'all-gradle-dependency-coordinates.csv');
      const artifacts = new Set(coords.map((c) => c['artifact']));
      let bad = 0;
      // guava: Groovy, one-line block. slf4j: Groovy, multi-line.
      // commons-lang3: Kotlin DSL, one-line block.
      for (const want of ['guava', 'slf4j-api', 'commons-lang3']) {
        if (!artifacts.has(want)) bad += fail(`${want} produced no coordinate`);
      }
      return bad;
    },
  },
  {
    name: 'entry:single-line-blocks-are-not-statements',
    proves: "`dependencies { implementation('x') }` on one line is a DEPENDENCY",
    run: (out) => {
      const leaked = tsv(out, 'all-gradle-declarations.csv')
        .filter((d) => d['declarationType'] === 'STATEMENT'
          && /^(method_invocation|string_fragment|juxt_function_call):/.test(d['name'] ?? ''));
      if (leaked.length) {
        return fail(`${leaked.length} call(s) fell to the catch-all, e.g. ${leaked[0]!['name']?.slice(0, 60)}`);
      }
      const plugins = tsv(out, 'all-gradle-declarations.csv').filter((d) => d['declarationType'] === 'PLUGIN');
      return plugins.length ? 0 : fail("`plugins { id 'java' }` produced no PLUGIN row");
    },
  },
  {
    name: 'entry:other-languages-still-run',
    proves: 'the Gradle analyzer does not suppress the rest of the pipeline',
    run: (out) => {
      const emitted = fs.readdirSync(out);
      return emitted.some((f) => f.startsWith('all-') && !f.startsWith('all-gradle-'))
        ? 0
        : fail(`only Gradle relations were written: ${emitted.join(', ')}`);
    },
  },
];

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

interface Suite { fixture: string; checks: Check[]; viaEntryPoint?: boolean }

const SUITES: Suite[] = [
  { fixture: 'multi-project', checks: [
    goldenCheck('multi-project'), arityCheck, integrityCheck,
    ...behaviourChecks.filter((c) => ![
      'kts-is-discovered', 'malformed-catalog-line-is-a-gap', 'lossy-rewrites-leave-a-gap',
    ].includes(c.name)),
  ] },
  { fixture: 'kotlin-dsl', checks: [
    goldenCheck('kotlin-dsl'), arityCheck, integrityCheck,
    ...behaviourChecks.filter((c) => ['kts-is-discovered', 'parse-status-matches-gap-count', 'keys-are-unique'].includes(c.name)),
  ] },
  { fixture: 'edge-cases', checks: [
    goldenCheck('edge-cases'), arityCheck, integrityCheck,
    ...behaviourChecks.filter((c) => ['lossy-rewrites-leave-a-gap', 'parse-status-matches-gap-count', 'block-tree-is-acyclic', 'keys-are-unique'].includes(c.name)),
  ] },
  { fixture: 'catalogs', checks: [
    goldenCheck('catalogs'), arityCheck, integrityCheck,
    ...behaviourChecks.filter((c) => ['malformed-catalog-line-is-a-gap', 'catalog-accessor-mapping', 'keys-are-unique'].includes(c.name)),
  ] },
  { fixture: 'entry-point', viaEntryPoint: true, checks: [
    arityCheck, integrityCheck, ...entryPointChecks,
    ...behaviourChecks.filter((c) => ['keys-are-unique', 'block-tree-is-acyclic', 'include-resolves-to-subproject'].includes(c.name)),
  ] },
];

async function main(): Promise<void> {
  if (process.argv.includes('--list')) {
    for (const s of SUITES) {
      console.log(`\n${s.fixture}`);
      for (const c of s.checks) console.log(`  ${c.name.padEnd(42)} ${c.proves}`);
    }
    return;
  }

  let failures = 0;
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gradle-tests-'));

  for (const suite of SUITES) {
    console.log(`\n▸ ${suite.fixture}`);
    const root = path.join(DATA, suite.fixture);
    const dest = path.join(tmp, suite.fixture);
    const out = suite.viaEntryPoint
      ? await analyseViaEntryPoint(root, dest)
      : await analyse(root, dest);
    for (const check of suite.checks) {
      const bad = check.run(out);
      failures += bad;
      if (!bad) console.log(`  ✓ ${check.name}`);
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(failures === 0
    ? '\n✅ all gradle checks passed'
    : `\n❌ ${failures} gradle check failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
