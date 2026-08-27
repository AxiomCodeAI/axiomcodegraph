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
export async function extractProject(opts: ExtractOptions): Promise<void> {
  const excludeTests = opts.excludeTests ?? false;
  const outputDir = opts.outputDir ? path.resolve(opts.outputDir) : undefined;

  if (excludeTests) {
    console.log('🚫 Test directories ("test", "tests") will be excluded from analysis\n');
  }

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

  await Promise.all([
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
    ...typescriptProjects.map((project) =>
      typescriptAnalyzer.analyze({
        rootDir: project.path,
        outputDir: outputDir ?? ANALYSIS_OUTPUT_DIR,
        baseMservPath: absolutePath,
        serviceVersionLink: opts.versionLink,
        excludeDirs: excludeTests
          ? ['node_modules', '.git', 'dist', 'build', 'out', 'coverage',
             'test', 'tests', '__tests__', '.next', '.turbo']
          : undefined,
      })),
    ...pythonProjects.map((project) =>
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
      })),
  ]);

  console.log('✨ Analysis complete!\n');
}
