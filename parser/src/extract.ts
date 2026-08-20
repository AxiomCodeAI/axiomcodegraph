import * as path from 'path';

import { ProjectInfo, ProjectLanguage } from '@/types/ProjectInfo';
import { ProjectScanner } from '@/utils/project-scanner';
import { GradleProjectAnalyzer } from '@/workflows/gradle/gradle-project-analyzer';
import { JavaProjectAnalyzer } from '@/workflows/java/java-project-analyzer';
import { PropertiesProjectAnalyzer } from '@/workflows/properties/properties-project-analyzer';
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
 * Scan a codebase and extract Java/Gradle/XML/YAML/Properties facts.
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

  const javaAnalyzer = new JavaProjectAnalyzer(undefined, outputDir);
  const propertiesAnalyzer = new PropertiesProjectAnalyzer(outputDir);
  const xmlAnalyzer = new XmlProjectAnalyzer(outputDir);
  const yamlAnalyzer = new YamlProjectAnalyzer(outputDir);
  const gradleAnalyzer = new GradleProjectAnalyzer(outputDir);

  await Promise.all([
    javaAnalyzer.analyzeJavaProjects(javaProjects, opts.versionLink, excludeTests),
    propertiesAnalyzer.analyzePropertiesFiles(scanTargets, opts.versionLink),
    xmlAnalyzer.analyzeXmlFiles(scanTargets, opts.versionLink),
    yamlAnalyzer.analyzeYamlFiles(scanTargets, opts.versionLink),
    gradleAnalyzer.analyzeGradleFiles(scanTargets, opts.versionLink),
  ]);

  console.log('✨ Analysis complete!\n');
}
