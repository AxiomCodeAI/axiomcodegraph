import * as path from 'path';

import { ANALYSIS_OUTPUT_DIR } from '@/constants/consts';
import { ProjectInfo, ProjectLanguage } from '@/types/ProjectInfo';
import { ProjectScanner } from '@/utils/project-scanner';
import { GradleProjectAnalyzer } from '@/workflows/gradle/gradle-project-analyzer';
import { JavaProjectAnalyzer } from '@/workflows/java/java-project-analyzer';
import { PropertiesProjectAnalyzer } from '@/workflows/properties/properties-project-analyzer';
import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';
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
}

/**
 * Scan a codebase and extract Java/Python/TypeScript/Gradle/XML/YAML/Properties facts.
 *
 * This is the parser core — shared by the CLI (`src/cli.ts`) and the legacy
 * positional entry (`src/index.ts`, invoked as `node dist/index.js <dir> <link>
 * <excludeTests> <outputDir>` by the orchestrator pipeline).
 */
/** Runs a promise and returns its value alongside how long it took, in seconds. */
async function timed<T>(work: Promise<T>): Promise<{ value: T; seconds: number }> {
  const startedAt = Date.now();
  const value = await work;
  return { value, seconds: (Date.now() - startedAt) / 1000 };
}

/**
 * Prints what a per-project analyzer produced.
 *
 * Java, XML, YAML, Gradle and Properties each print their own tallies from
 * inside their workflow. Python and TypeScript return a summary object instead,
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

export async function extractProject(opts: ExtractOptions): Promise<void> {
  const excludeTests = opts.excludeTests ?? false;
  const outputDir = opts.outputDir ? path.resolve(opts.outputDir) : undefined;

  if (excludeTests) {
    console.log('🚫 Test directories ("test", "tests") will be excluded from analysis\n');
  }

  const startedAt = Date.now();
  const absolutePath = path.resolve(opts.projectPath);
  const scanner = new ProjectScanner();

  console.log('⏳ Scanning for projects...');
  const allProjects = await scanner.scanForProjects(absolutePath);
  console.log(`✅ Scan complete! Found ${allProjects.length} total project(s)\n`);

  const projectsByLanguage = scanner.groupByLanguage(allProjects);
  console.log('📋 Projects by language:');
  for (const [language, projects] of projectsByLanguage) {
    console.log(`   ${language}: ${projects.length} project(s)`);
  }

  // Ensure the root directory is always included as a scan target for file-type
  // analyzers (XML, YAML, Properties, Gradle) so root-level config files like
  // build.xml, settings.gradle, pom.xml, etc. are not missed.
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

  const javaAnalyzer = new JavaProjectAnalyzer(undefined, outputDir);
  const propertiesAnalyzer = new PropertiesProjectAnalyzer(outputDir);
  const xmlAnalyzer = new XmlProjectAnalyzer(outputDir);
  const yamlAnalyzer = new YamlProjectAnalyzer(outputDir);
  const gradleAnalyzer = new GradleProjectAnalyzer(outputDir);
  const pythonAnalyzer = new PythonProjectAnalyzer();
  const typescriptAnalyzer = new TypeScriptProjectAnalyzer();

  // Positions matter: java, properties, xml, yaml, gradle, typescript, python.
  // Counting them wrong bound typescriptSummaries to gradle's void return, and
  // the mistake surfaced only as a type error.
  const [, , , , , typescriptSummaries, pythonSummaries] = await Promise.all([
    javaAnalyzer.analyzeJavaProjects(javaProjects, opts.versionLink, excludeTests),
    propertiesAnalyzer.analyzePropertiesFiles(scanTargets, opts.versionLink),
    xmlAnalyzer.analyzeXmlFiles(scanTargets, opts.versionLink),
    yamlAnalyzer.analyzeYamlFiles(scanTargets, opts.versionLink),
    gradleAnalyzer.analyzeGradleFiles(scanTargets, opts.versionLink),
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
    // One call per PROJECT, not one over the repository root, because a
    // TypeScript program is the unit of merge scope: two programs have two
    // global scopes, and analysing them together merges symbols tsc keeps apart.
    timed(Promise.all(typescriptProjects.map((project) =>
      typescriptAnalyzer.analyze({
        rootDir: project.path,
        outputDir: outputDir ?? ANALYSIS_OUTPUT_DIR,
        baseMservPath: absolutePath,
        serviceVersionLink: opts.versionLink,
        excludeDirs: excludeTests
          ? ['node_modules', '.git', 'dist', 'build', 'out', 'coverage',
             'test', 'tests', '__tests__', '.next', '.turbo']
          : undefined,
      })))),
    timed(Promise.all(pythonProjects.map((project) =>
      pythonAnalyzer.analyze({
        rootDir: project.path,
        outputDir: outputDir ?? ANALYSIS_OUTPUT_DIR,
        baseMservPath: absolutePath,
        serviceVersionLink: opts.versionLink,
        // Python has no excludeTests flag; test discovery is by convention, so
        // the equivalent is skipping the directories those conventions use.
        // The defaults are repeated because excludeDirs REPLACES them rather
        // than adding to them — passing only the test names would have started
        // analysing .venv and site-packages as project source.
        excludeDirs: excludeTests
          ? ['__pycache__', '.git', 'node_modules', '.venv', 'venv', '.tox',
             'tests', 'test', '__tests__']
          : undefined,
      })))),
  ]);

  // Python and TypeScript ran and wrote their CSVs but reported nothing, while
  // every other language printed counts and a duration. A run over a Python
  // project ended on "Found 0 Java project(s)" and a string of empty XML and
  // Gradle tallies, with no sign the Python analysis had happened at all. The
  // summaries were already returned by the analyzers and simply discarded.
  reportLanguage('Python', pythonSummaries.seconds, pythonSummaries.value);
  reportLanguage('TypeScript', typescriptSummaries.seconds, typescriptSummaries.value);

  // Wall clock for the whole run. The per-language figures above will NOT sum to
  // it: the analyzers run concurrently, so their durations overlap. Reporting
  // both is the point -- the per-language number says which parser is slow, the
  // total says what the caller actually waited.
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`\n⏱️  TOTAL analysis time: ${elapsed}s`);
  console.log('✨ Analysis complete!\n');
}
