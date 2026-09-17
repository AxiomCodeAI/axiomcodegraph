import { CSharpProjectAnalyzer } from '@/workflows/csharp/csharp-project-analyzer';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

import { JAVA_TEST_DIR, ANALYSIS_OUTPUT_DIR } from '@/constants/consts';
import { ProjectInfo, ProjectLanguage } from '@/types/ProjectInfo';
import { ProjectScanner } from '@/utils/project-scanner';
import { GradleProjectAnalyzer } from '@/workflows/gradle/gradle-project-analyzer';
import { JavaProjectAnalyzer } from '@/workflows/java/java-project-analyzer';
import { PropertiesProjectAnalyzer } from '@/workflows/properties/properties-project-analyzer';
import { DEFAULT_EXCLUDES as PYTHON_DEFAULT_EXCLUDES, PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';
import { ServicesProjectAnalyzer } from '@/workflows/services/services-project-analyzer';
import { JavaScriptProjectAnalyzer } from '@/workflows/javascript/javascript-project-analyzer';
import { TypeScriptProjectAnalyzer } from '@/workflows/typescript/typescript-project-analyzer';
import { XmlProjectAnalyzer } from '@/workflows/xml/xml-project-analyzer';
import { YamlProjectAnalyzer } from '@/workflows/yaml/yaml-project-analyzer';

export interface ExtractOptions {
  /** Path to the project/codebase to scan. */
  projectPath: string;
  /** Service-version link / commit tag stamped onto every extracted fact. */
  versionLink: string;
  /** Exclude test directories ("test", "tests"). Default: false. */
  excludeTests?: boolean;
  /** Directory to write extracted facts to. Default: the analyzers' built-in location. */
  outputDir?: string;
  /**
   * `flat` (default): every language's tables side by side in outputDir, as always.
   * `per-language`: outputDir/java/, outputDir/typescript/, outputDir/python/,
   * outputDir/javascript/ — one folder per language that had a project, holding only
   * that language's tables (the config tables — properties, XML, YAML, Gradle,
   * services — go with Java, whose rules are the only reader). A consumer that solves
   * one language at a time points at one folder and sees nothing else.
   */
  layout?: 'flat' | 'per-language';
  /**
   * The tree is a DEPENDENCY being staged, not the project under analysis.
   *
   * Passed to the JavaScript analyzer, where it decides whether a root's own build
   * output directory is walked as its source (#620) or skipped as the artefact beside
   * the source (#796). `bin/axiomcode` sets it for every `--library` entry.
   */
  library?: boolean;
}

/**
 * Merge the relation files several per-project runs wrote into their own scratch
 * folders into one set: the header once, every project's rows after it, in project
 * order. Two TypeScript (or Python) projects in one tree used to be analysed
 * concurrently into the SAME folder, and each relation was opened with a truncating
 * write — whichever project finished last kept its rows and the other's vanished,
 * silently and in an order that varied between runs. The JavaScript analyzer avoids
 * this by unioning its roots up front; the languages that take one root per call
 * get the same guarantee here, at the file level, without touching their analyzers.
 * A zero-byte relation (no rows, no header) contributes nothing but still ensures
 * the file exists in the merged set.
 */
async function mergeProjectOutputs(scratchDirs: string[], outputDir: string): Promise<void> {
  const seen = new Map<string, boolean>(); // filename → header already written
  for (const dir of scratchDirs) {
    let names: string[] = [];
    try { names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.csv')); } catch { continue; }
    for (const name of names.sort()) {
      const src = path.join(dir, name);
      const dst = path.join(outputDir, name);
      const text = await fsp.readFile(src, 'utf-8');
      if (!seen.has(name)) {
        await fsp.writeFile(dst, text, 'utf-8');
        seen.set(name, text.length > 0);
        continue;
      }
      if (text.length === 0) continue;
      const nl = text.indexOf('\n');
      const header = nl < 0 ? text : text.slice(0, nl);
      const body = nl < 0 ? '' : text.slice(nl + 1);
      if (!seen.get(name)) {
        // the first project wrote a zero-byte file for this relation; this one has rows
        await fsp.writeFile(dst, header + '\n' + body, 'utf-8');
        seen.set(name, true);
      } else if (body.length > 0) {
        await fsp.appendFile(dst, body.endsWith('\n') ? body : body + '\n', 'utf-8');
      }
    }
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** A fresh scratch folder per project, under the output directory so it is on the same volume. */
function scratchFor(outputDir: string, language: string, index: number): string {
  const dir = path.join(outputDir, `.${language}-project-${index}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Runs a promise and returns its value alongside how long it took, in seconds. */
async function timed<T>(work: Promise<T>): Promise<{ value: T; seconds: number }> {
  const startedAt = Date.now();
  const value = await work;
  return { value, seconds: (Date.now() - startedAt) / 1000 };
}

/**
 * Prints what a per-project analyzer produced.
 *
 * Java, XML, YAML, Gradle, Properties and services each print their own
 * tallies from inside their workflow. Python and TypeScript return a summary object instead,
 * which nothing was reading, so those two languages were silent even on a run
 * that analysed hundreds of files. `filesRejected` and `extractionErrors` are
 * printed separately and only when non-zero: a rejection is a decision, an
 * extraction error is always a defect, and a caller that cannot tell them apart
 * cannot tell a clean run from a parser that crashed on every file.
 */
function reportLanguage(
  label: string,
  seconds: number,
  summaries: ReadonlyArray<{
    filesSeen: number;
    filesAnalysed: number;
    filesRejected?: number;
    extractionErrors?: number;
    counts?: Record<string, number>;
    skippedByDirectory?: Readonly<Record<string, number>>;
  }>
): void {
  if (summaries.length === 0) {
    return;
  }
  const total = (pick: (s: (typeof summaries)[number]) => number | undefined): number =>
    summaries.reduce((sum, s) => sum + (pick(s) ?? 0), 0);
  const analysed = total((s) => s.filesAnalysed);
  const rows = summaries.reduce(
    (sum, s) => sum + Object.values(s.counts ?? {}).reduce((a, b) => a + b, 0),
    0
  );
  // Padded to the same column the other languages use, so a run reads as one
  // report rather than two formats.
  const field = (text: string): string => `${label} ${text}:`.padEnd(30);
  console.log(`\n📊 ${field('files analysed')}${analysed}`);
  // What the walk PRUNED, by directory name (#790). Without this line a repository
  // whose first-party packages sit under an excluded directory name reports a
  // plausible small file count and nothing else, and the loss is invisible to
  // every reader downstream.
  const prunedByName = new Map<string, number>();
  for (const summary of summaries) {
    for (const [name, count] of Object.entries(summary.skippedByDirectory ?? {})) {
      prunedByName.set(name, (prunedByName.get(name) ?? 0) + count);
    }
  }
  const pruned = [...prunedByName.entries()].sort((a, b) => b[1] - a[1]);
  const prunedTotal = pruned.reduce((sum, [, count]) => sum + count, 0);
  if (prunedTotal > 0) {
    const detail = pruned.slice(0, 4).map(([name, count]) => `${name} ${count}`).join(', ');
    console.log(`📊 ${field('files under excluded dirs')}${prunedTotal}  (${detail})`);
  }
  console.log(`📊 ${field('rows extracted')}${rows}`);
  const rejected = total((s) => s.filesRejected);
  const errored = total((s) => s.extractionErrors);
  if (rejected > 0) {
    console.log(`   ⏭  ${rejected} file(s) skipped — see the skipped-files report`);
  }
  if (errored > 0) {
    console.log(`   ❌ ${errored} file(s) errored during extraction`);
  }
  console.log(`⏱️  ${label} analysis completed in ${seconds.toFixed(2)}s`);
}

/**
 * Scan a codebase and extract Java/Python/TypeScript/Gradle/XML/YAML/Properties
 * and META-INF/services facts.
 *
 * This is the parser core and the package's main export. `src/index.ts` wraps it
 * for command-line use; import it directly to drive the parser from code.
 */
export async function extractProject(opts: ExtractOptions): Promise<void> {
  const excludeTests = opts.excludeTests ?? false;
  const outputDir = opts.outputDir ? path.resolve(opts.outputDir) : undefined;

  if (excludeTests) {
    console.log(`🚫 Test directories (${JAVA_TEST_DIR.source}) will be excluded from analysis\n`);
  }

  const startedAt = Date.now();
  const absolutePath = path.resolve(opts.projectPath);
  const scanner = new ProjectScanner();

  console.log('⏳ Scanning for projects...');
  // Discovery itself honours the flag: a test directory is never a root (#613).
  const allProjects = await scanner.scanForProjects(absolutePath, 3, excludeTests);
  console.log(`✅ Scan complete! Found ${allProjects.length} total project(s)\n`);

  const projectsByLanguage = scanner.groupByLanguage(allProjects);
  console.log('📋 Projects by language:');
  for (const [language, projects] of projectsByLanguage) {
    console.log(`   ${language}: ${projects.length} project(s)`);
  }

  // Ensure the root directory is always included as a scan target for file-type
  // analyzers (XML, YAML, Properties, Gradle, services) so root-level config
  // files like build.xml, settings.gradle, pom.xml, etc. are not missed.
  const rootEntry: ProjectInfo = {
    name: path.basename(absolutePath),
    path: absolutePath,
    language: ProjectLanguage.UNKNOWN,
    hasSourceFiles: false,
  };
  const rootAlreadyIncluded = allProjects.some(p => p.path === absolutePath);
  const scanTargets: ProjectInfo[] = rootAlreadyIncluded
    ? allProjects
    : [rootEntry, ...allProjects];

  const javaProjects = scanner.filterByLanguage(allProjects, ProjectLanguage.JAVA);
  const pythonProjects = scanner.filterByLanguage(allProjects, ProjectLanguage.PYTHON);
  const typescriptProjects = scanner.filterByLanguage(allProjects, ProjectLanguage.TYPESCRIPT);
  const javascriptProjects = scanner.filterByLanguage(allProjects, ProjectLanguage.JAVASCRIPT);
  const csharpProjects = scanner.filterByLanguage(allProjects, ProjectLanguage.CSHARP);

  // Where each language writes. Flat: everything into outputDir. Per-language: a folder per
  // language, created only for a language that had a project, so an absent language leaves
  // no folder of zero-byte tables behind.
  const perLanguage = opts.layout === 'per-language';
  const baseOut = outputDir ?? ANALYSIS_OUTPUT_DIR;
  const dirFor = (language: string, present: boolean): string | undefined => {
    if (!perLanguage) return outputDir;
    if (!present) return undefined;
    const d = path.join(baseOut, language);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const javaOut = dirFor('java', javaProjects.length > 0);
  const typescriptOut = dirFor('typescript', typescriptProjects.length > 0);
  const pythonOut = dirFor('python', pythonProjects.length > 0);
  const javascriptOut = dirFor('javascript', javascriptProjects.length > 0);
  const csharpOut = dirFor('csharp', csharpProjects.length > 0);
  // The config analyzers walk every scan target and always write; without a Java project
  // their tables have no reader, so in per-language mode they go to a scratch folder that
  // is discarded rather than into a java/ folder that would announce a language absent here.
  const configOut = perLanguage ? (javaOut ?? scratchFor(baseOut, 'config', 0)) : outputDir;

  const javaAnalyzer = new JavaProjectAnalyzer(undefined, javaOut ?? (perLanguage ? scratchFor(baseOut, 'java', 0) : outputDir));
  const propertiesAnalyzer = new PropertiesProjectAnalyzer(configOut);
  const xmlAnalyzer = new XmlProjectAnalyzer(configOut);
  const yamlAnalyzer = new YamlProjectAnalyzer(configOut);
  const gradleAnalyzer = new GradleProjectAnalyzer(configOut);
  const servicesAnalyzer = new ServicesProjectAnalyzer(configOut);
  const pythonAnalyzer = new PythonProjectAnalyzer();
  const typescriptAnalyzer = new TypeScriptProjectAnalyzer();
  const javascriptAnalyzer = new JavaScriptProjectAnalyzer();
  const csharpAnalyzer = new CSharpProjectAnalyzer();

  // Positions matter: java, properties, xml, yaml, gradle, services, typescript,
  // python, javascript, csharp. Counting them wrong bound typescriptSummaries to
  // gradle's void return, and the mistake surfaced only as a type error — so a
  // new analyzer is APPENDED rather than inserted, and the destructuring below
  // is checked against this list rather than against memory.
  const [, , , , , , typescriptSummaries, pythonSummaries, javascriptSummaries, csharpSummaries]
    = await Promise.all([
    javaAnalyzer.analyzeJavaProjects(javaProjects, opts.versionLink, excludeTests),
    propertiesAnalyzer.analyzePropertiesFiles(scanTargets, opts.versionLink),
    xmlAnalyzer.analyzeXmlFiles(scanTargets, opts.versionLink),
    yamlAnalyzer.analyzeYamlFiles(scanTargets, opts.versionLink),
    gradleAnalyzer.analyzeGradleFiles(scanTargets, opts.versionLink),
    // META-INF/services is given the same scan targets as the other file-type
    // analyzers rather than the Java project list: a provider-configuration file
    // lives in a resources directory, which a module may ship with no .java
    // source of its own.
    servicesAnalyzer.analyzeServicesFiles(scanTargets, opts.versionLink),
    // Python takes one root per call where Java takes the whole list, so the
    // projects are walked here rather than pushing a list-shaped API onto it.
    // serviceVersionLink is passed UNHASHED on purpose: the analyzer hashes it
    // the same way Java does, so the two languages produce joinable values.
    // Passing a raw string into a column named ...LinkHash is the mistake that
    // option exists to prevent.
    // TypeScript takes one root per call, as Python does. serviceVersionLink is
    // passed UNHASHED on purpose: the analyzer hashes it exactly as Java and
    // Python do, so the three languages produce joinable values. Passing a raw
    // string into a column named ...LinkHash is the mistake that option exists
    // to prevent.
    //
    // A TypeScript PROGRAM is the unit of merge scope: two programs have two
    // global scopes, and analysing them as one merges symbols tsc keeps apart.
    // So the work is per program, and `analyzePrograms` is what expands a
    // discovered project into them -- a monorepo root's tsconfig claims only
    // the files at the top, and every package below is its own program, so
    // treating the project as one program reached 24 of 965 files on one such
    // repository. The output is one flat set, as Java's is.
    timed(Promise.all(typescriptProjects.map((project, i) =>
      typescriptAnalyzer.analyzePrograms({
        rootDir: project.path,
        // one scratch folder per project; merged below — see mergeProjectOutputs
        outputDir: scratchFor(typescriptOut ?? baseOut, 'typescript', i),
        baseMservPath: absolutePath,
        serviceVersionLink: opts.versionLink,
        excludeDirs: excludeTests
          ? ['node_modules', '.git', 'dist', 'build', 'out', 'coverage',
             'test', 'tests', '__tests__', '.next', '.turbo']
          : undefined,
      })))),
    timed(Promise.all(pythonProjects.map((project, i) =>
      pythonAnalyzer.analyze({
        rootDir: project.path,
        outputDir: scratchFor(pythonOut ?? baseOut, 'python', i),
        baseMservPath: absolutePath,
        serviceVersionLink: opts.versionLink,
        // Python has no excludeTests flag; test discovery is by convention, so
        // the equivalent is skipping the directories those conventions use.
        // excludeDirs REPLACES the analyzer's own defaults rather than adding
        // to them, so PYTHON_DEFAULT_EXCLUDES is spread in here rather than
        // hand-copied — a hand-copy is exactly how this list and the
        // analyzer's fell out of step and left `build/lib*` unexcluded on
        // this branch while the analyzer's default list separately lacked it
        // too (#564).
        excludeDirs: excludeTests
          ? [...PYTHON_DEFAULT_EXCLUDES, 'tests', 'test', '__tests__']
          : undefined,
      })))),
    // JavaScript takes one root per call, as Python and TypeScript do, and
    // hashes serviceVersionLink itself so all four languages produce joinable
    // values. Unlike TypeScript there is no program expansion: JavaScript has no
    // tsconfig to define one, and the per-file unit of configuration is the
    // nearest `package.json`, which the analyzer resolves per file.
    // ONE call for every JavaScript root, not one per project. Calling per
    // project against a single output directory does not merge the sets, it
    // OVERWRITES them — every project but the last vanishes — and concurrently
    // it races on the temporary files as well. `analyzeAll` unions the file
    // lists first, which also deduplicates the files a monorepo root and its
    // packages both claim.
    timed(Promise.all([
      javascriptAnalyzer.analyzeAll(javascriptProjects.map((project) => project.path), {
        outputDir: javascriptOut ?? (perLanguage ? scratchFor(baseOut, 'javascript', 0) : baseOut),
        baseMservPath: absolutePath,
        serviceVersionLink: opts.versionLink,
        libraryRoot: opts.library === true,
        // excludeDirs REPLACES the defaults rather than adding to them, so the
        // defaults are repeated — passing only the test names would have started
        // analysing node_modules as project source, which is the one thing the
        // provenance split exists to prevent.
        excludeDirs: excludeTests
          ? ['node_modules', 'bower_components', '.git', 'dist', 'build', 'out',
             'coverage', '.next', '.nuxt', '.turbo', '.cache', '.yarn',
             'test', 'tests', '__tests__', 'spec']
          : undefined,
      }),
    ])),
    // C# takes one root per call, as Python and TypeScript do, and hashes
    // serviceVersionLink the same way. What it does NOT take from the project is
    // its CONFIGURATION: target frameworks, define constants and implicit usings
    // are in cs_module's primary key and are INPUTS by design. Reading a .csproj
    // would eventually mean evaluating MSBuild, and no .NET runs in this
    // process — the parser is a Node library that runs on arbitrary customer
    // checkouts, and a .NET runtime dependency is a different product.
    //
    // ALL the C# projects go through ONE analyzer call: they share an output
    // directory, so they must share the writers, or each project's publish
    // replaces the last one's rows (CS-ORACLE-3 — 52 projects, and two publishes
    // in one millisecond collided on a temporary name).
    timed(csharpProjects.length === 0
      ? Promise.resolve([])
      : csharpAnalyzer.analyzeMany(csharpProjects.map((project) => project.path), {
          outputDir: csharpOut ?? (perLanguage ? scratchFor(baseOut, 'csharp', 0) : baseOut),
          baseMservPath: absolutePath,
          serviceVersionLink: opts.versionLink,
          excludeDirs: excludeTests
            ? ['obj', 'bin', '.git', 'node_modules', 'packages', '.vs',
               'test', 'tests', 'Tests', 'UnitTests', 'IntegrationTests']
            : undefined,
        }).then((summary) => [summary])),
  ]);

  // Every per-project scratch folder is merged into its language's folder now, in project
  // order, and removed. In flat mode the language folder IS outputDir.
  await mergeProjectOutputs(typescriptProjects.map((_, i) => path.join(typescriptOut ?? baseOut, `.typescript-project-${i}`)), typescriptOut ?? baseOut);
  await mergeProjectOutputs(pythonProjects.map((_, i) => path.join(pythonOut ?? baseOut, `.python-project-${i}`)), pythonOut ?? baseOut);
  // The JavaScript analyzer walks the root whether or not discovery called it a project,
  // and a package that ships only `dist/` (#620) is exactly the case where it did not:
  // `dist` is a skip directory for discovery, so the package is no project, yet the
  // analyzer read its entry files. Its tables were written to the scratch folder and then
  // thrown away as a stray, so `--library` on such a package staged nothing and the CLI
  // aborted the whole run (#709). The output folder is decided by what the analyzer
  // EMITTED, not by what discovery found: a scratch run that analysed a file is promoted
  // to javascript/ like any discovered project's output.
  if (perLanguage && javascriptOut === undefined
      && javascriptSummaries.value.some((s) => s.filesAnalysed > 0)) {
    const promoted = dirFor('javascript', true)!;
    await mergeProjectOutputs([path.join(baseOut, '.javascript-project-0')], promoted);
  }
  if (perLanguage) {
    for (const stray of ['.config-project-0', '.java-project-0', '.javascript-project-0']) {
      fs.rmSync(path.join(baseOut, stray), { recursive: true, force: true });
    }
  }

  // Python and TypeScript ran and wrote their CSVs but reported nothing, while
  // every other language printed counts and a duration. A run over a Python
  // project ended on "Found 0 Java project(s)" and a string of empty XML and
  // Gradle tallies, with no sign the Python analysis had happened at all. The
  // summaries were already returned by the analyzers and simply discarded.
  reportLanguage('Python', pythonSummaries.seconds, pythonSummaries.value);
  reportLanguage('TypeScript', typescriptSummaries.seconds, typescriptSummaries.value);
  reportLanguage('JavaScript', javascriptSummaries.seconds, javascriptSummaries.value);
  reportLanguage('C#', csharpSummaries.seconds, csharpSummaries.value);

  // Wall clock for the whole run. The per-language figures above will NOT sum to
  // it: the analyzers run concurrently, so their durations overlap. Reporting
  // both is the point -- the per-language number says which parser is slow, the
  // total says what the caller actually waited.
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`\n⏱️  TOTAL analysis time: ${elapsed}s`);
  console.log('✨ Analysis complete!\n');
}
