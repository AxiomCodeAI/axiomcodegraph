/**
 * DIFFERENTIAL GATE — compare the emitted relations against Gradle itself.
 *
 *     npx tsx src/test/gradle-gates/diff-gradle-model.ts <repo>
 *
 * ## Why this exists, and why it is separate
 *
 * The fixture suite compares the parser against expectations that were written
 * next to the parser, so the two share a premise and a shared premise cannot
 * be tested by either. The corpus gate does better — it checks properties that
 * must hold of any correct output — but it still never asks whether the rows
 * say the right thing about the build.
 *
 * Only Gradle can answer that. It is the implementation that decides what a
 * build file means: which projects exist, what each one's path is, and which
 * coordinates a configuration actually resolves to. Every column this gate
 * checks is a column that has an authority outside this repository, which is
 * the standard the rest of the parser is held to.
 *
 * ## What it checks
 *
 * `gradle -q projects` prints the project graph the settings file produced.
 * That is compared against GRADLE_SCRIPT.gradleProjectPath and the resolved
 * INCLUDE edges — the two things this parser derives from directory layout and
 * a `buildFileName` heuristic, and therefore the two most likely to be wrong.
 *
 * `gradle -q dependencies --configuration <c>` prints the coordinates Gradle
 * resolved. Only DECLARED coordinates are compared: Gradle's output includes
 * every transitive dependency, and this is a front end that reads source text
 * and does not resolve a graph. A declared coordinate missing from Gradle's
 * output is a defect; a resolved coordinate missing from ours is not.
 *
 * ## When it skips
 *
 * No Gradle on the path and no wrapper in the repository means no oracle, and
 * the gate says so rather than passing. A gate that reports only successes is
 * not reporting — a skip must be visible as a skip.
 *
 * Running it takes a JVM, a Gradle distribution, and usually the network,
 * which is why it is not part of `gradle-tests.ts`.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GradleProjectAnalyzer } from '@/workflows/gradle/gradle-project-analyzer';

type Row = Record<string, string>;

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

/** The wrapper is preferred: it pins the version the build was written for. */
function findGradle(repo: string): { cmd: string; args: string[] } | null {
  const wrapper = path.join(repo, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  if (fs.existsSync(wrapper)) return { cmd: wrapper, args: [] };
  try {
    execFileSync('gradle', ['--version'], { stdio: 'ignore' });
    return { cmd: 'gradle', args: [] };
  } catch {
    return null;
  }
}

function runGradle(gradle: { cmd: string; args: string[] }, repo: string, task: string[]): string | null {
  try {
    return execFileSync(gradle.cmd, [...gradle.args, '-q', '--offline', ...task], {
      cwd: repo,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ⚠️  gradle ${task.join(' ')} failed: ${message.split('\n')[0]}`);
    return null;
  }
}

/**
 * `gradle projects` prints a tree with lines like:
 *     +--- Project ':core'
 *     |    \--- Project ':core:api'
 */
function parseProjectList(output: string): Set<string> {
  const paths = new Set<string>();
  for (const line of output.split('\n')) {
    const m = /Project '([^']+)'/.exec(line);
    if (m && m[1]) paths.add(m[1]);
  }
  return paths;
}

async function main(): Promise<void> {
  const repo = process.argv[2];
  if (!repo || !fs.existsSync(repo)) {
    console.error('usage: diff-gradle-model.ts <repo>');
    process.exit(2);
  }

  const gradle = findGradle(repo);
  if (!gradle) {
    console.log('⏭️  SKIPPED — no gradlew in the repository and no gradle on PATH.');
    console.log('   This gate is the only check with an authority outside this repo.');
    console.log('   Nothing it covers was verified by the run above.');
    process.exit(0);
  }
  console.log(`▸ oracle: ${gradle.cmd}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-diff-'));
  const silence = console.log;
  console.log = () => {};
  try {
    await new GradleProjectAnalyzer(tmp).analyzeGradleFiles(
      [{ name: path.basename(repo), path: repo, language: 'UNKNOWN' as never, hasSourceFiles: false }],
      'diff-gate'
    );
  } finally {
    console.log = silence;
  }

  let failures = 0;
  let verified = 0;

  // ── the project graph ───────────────────────────────────────────────────
  const projectsOutput = runGradle(gradle, repo, ['projects']);
  if (projectsOutput === null) {
    console.log('  ⚠️  project graph NOT VERIFIED');
  } else {
    verified++;
    const expected = parseProjectList(projectsOutput);
    const scripts = tsv(tmp, 'all-gradle-scripts.csv');
    const ours = new Set(
      scripts.map((s) => s['gradleProjectPath'] ?? '').filter((p) => p && p !== ':')
    );
    // Gradle lists the root as ':' plus a name line; both sides drop it.
    expected.delete(':');

    // `include ':nested:deep'` makes Gradle create `:nested` too, even though
    // no file describes it. This parser's rows are about SCRIPTS, so a project
    // with no build file correctly has no row — comparing against it would
    // demand a row for something there is nothing to read. Only projects that
    // actually have a build file on disk are required to be attributed.
    const hasBuildFile = (projectPath: string): boolean => {
      const rel = projectPath.replace(/^:/, '').split(':').filter(Boolean).join(path.sep);
      return ['build.gradle', 'build.gradle.kts'].some(
        (b) => fs.existsSync(path.join(repo, rel, b))
      );
    };

    const comparable = [...expected].filter(hasBuildFile);
    const missing = comparable.filter((p) => !ours.has(p));
    const extra = [...ours].filter((p) => !expected.has(p));

    console.log(`  project graph: gradle=${expected.size} (${comparable.length} with a build file) ours=${ours.size}`);
    for (const p of missing.slice(0, 10)) {
      console.log(`  ✗ gradle knows project ${p} and it has a build file; no script carries that path`);
      failures++;
    }
    // An extra path is the worse error: it is a project this parser invented.
    for (const p of extra.slice(0, 10)) {
      console.log(`  ✗ we claim project ${p}; gradle does not have it`);
      failures++;
    }
    if (!missing.length && !extra.length) {
      console.log(`  ✓ every project with a build file is attributed, and none invented`);
    }
  }

  // ── declared coordinates ────────────────────────────────────────────────
  const depsOutput = runGradle(gradle, repo, ['dependencies', '--configuration', 'compileClasspath']);
  if (depsOutput === null) {
    console.log('  ⚠️  coordinates NOT VERIFIED');
  } else {
    verified++;
    // Lines look like `+--- org.group:artifact:1.0` or `... -> 2.0 (*)`.
    const gradleModules = new Set<string>();
    for (const line of depsOutput.split('\n')) {
      const m = /[\\+\\\\|-]{2,}\s+([\w.-]+):([\w.-]+)(?::|$| )/.exec(line);
      if (m) gradleModules.add(`${m[1]}:${m[2]}`);
    }

    // An offline run with nothing in the cache resolves nothing, and comparing
    // against an empty set would report every declared module as suspect. That
    // is an unverified comparison, not a failed one.
    if (gradleModules.size === 0) {
      console.log('  ⚠️  coordinates NOT VERIFIED — gradle resolved no modules (offline cache empty?)');
      verified--;
    }

    const coords = tsv(tmp, 'all-gradle-dependency-coordinates.csv')
      .filter((c) => c['group'] && c['artifact']);
    const declared = new Set(coords.map((c) => `${c['group']}:${c['artifact']}`));

    // Only our side is checked. Gradle prints the transitive closure; this is
    // a front end that reads declarations, so a coordinate Gradle resolved and
    // we never saw is expected, not a defect.
    const invented = gradleModules.size === 0
      ? []
      : [...declared].filter((m) => !gradleModules.has(m));
    console.log(`  coordinates: declared=${declared.size} gradle-resolved=${gradleModules.size}`);
    if (invented.length) {
      console.log(`  ⚠️  ${invented.length} declared module(s) absent from gradle's resolution`);
      console.log('     (expected for other configurations, platforms and excluded modules;');
      console.log('      a large number here is worth reading)');
      for (const m of invented.slice(0, 10)) console.log(`       ${m}`);
    } else if (gradleModules.size > 0) {
      console.log('  ✓ every declared module appears in gradle\'s resolution');
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n❌ ${failures} disagreement(s) with gradle`);
    process.exit(1);
  }

  // Gradle was found but every invocation failed — a stale plugin, an
  // incompatible JDK, a dependency the offline cache does not hold. Nothing
  // was compared, and printing a tick here would be the exact failure this
  // gate exists to prevent: a check that reports only successes is not
  // reporting. Exit non-zero so a pipeline treats it as unverified rather
  // than as a pass.
  if (verified === 0) {
    console.log('\n⚠️  NOT VERIFIED — gradle was found but no invocation succeeded.');
    console.log('   Nothing in the emitted relations was checked against an outside authority.');
    process.exit(3);
  }

  console.log(`\n✅ differential gate passed (${verified}/2 comparisons ran)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
