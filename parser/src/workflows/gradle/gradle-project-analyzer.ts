import * as fs from 'fs/promises';
import * as path from 'path';

import { GradleBlock } from '@/analysis-types/gradle/GradleBlock';
import { GradleCatalogEntry } from '@/analysis-types/gradle/GradleCatalogEntry';
import { GradleComment } from '@/analysis-types/gradle/GradleComment';
import { GradleDeclaration } from '@/analysis-types/gradle/GradleDeclaration';
import { GradleDependencyCoordinate } from '@/analysis-types/gradle/GradleDependencyCoordinate';
import { GradleParseGap } from '@/analysis-types/gradle/GradleParseGap';
import { GradleScript } from '@/analysis-types/gradle/GradleScript';
import { GradleValueReference } from '@/analysis-types/gradle/GradleValueReference';
import {
  EXCLUDED_DIRS, ANALYSIS_OUTPUT_DIR,
  OUTPUT_GRADLE_BLOCK_CSV_FILENAME, OUTPUT_GRADLE_DECLARATION_CSV_FILENAME,
  OUTPUT_GRADLE_VALUE_REFERENCE_CSV_FILENAME, OUTPUT_GRADLE_SCRIPT_CSV_FILENAME,
  OUTPUT_GRADLE_DEPENDENCY_COORDINATE_CSV_FILENAME, OUTPUT_GRADLE_CATALOG_ENTRY_CSV_FILENAME,
  OUTPUT_GRADLE_COMMENT_CSV_FILENAME, OUTPUT_GRADLE_PARSE_GAP_CSV_FILENAME,
  OUTPUT_SKIPPED_GRADLE_FILES_CSV_FILENAME, LARGE_FILE_LINE_THRESHOLD,
} from '@/constants/consts';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { GradleParseStatus } from '@/enums/gradle/files/GradleParseStatus';
import { GradleScriptKind } from '@/enums/gradle/files/GradleScriptKind';
import { GradleParseGapReason } from '@/enums/gradle/parse-gaps/GradleParseGapReason';
import { GradleCatalogExtractor } from '@/parsers/gradle/extractors/gradle-catalog-extractor';
import { GradleFileExtractor } from '@/parsers/gradle/extractors/gradle-file-extractor';
import { GradleResolutionLinker } from '@/parsers/gradle/gradle-resolution-linker';
import { GradleScriptClassifier } from '@/parsers/gradle/gradle-script-classifier';
import { ProjectInfo } from '@/types/ProjectInfo';
import { EntityUtils } from '@/utils/entity-utils';

interface SkippedGradleFile {
  filePath: string;
  baseMservPath: string;
  serviceVersionHash: string;
  reason: SkippedFileReason;
  uniqueFileHash: string;
}

/**
 * Analyses a codebase's Gradle build and writes eight relations.
 *
 * ## Discovery runs in two passes, and has to
 *
 * The first pass finds every candidate file and notes which directories hold a
 * settings script. Only then can the second pass classify anything: a
 * `build.gradle` beside a settings file is a ROOT_BUILD that may configure
 * every project in the build, and the identical file one directory down is a
 * PROJECT_BUILD that configures exactly one. Classifying on the way through
 * the tree would have to guess, and the guess is wrong for every multi-project
 * build — which is every build large enough to matter.
 *
 * Version catalogs are read before build scripts within the second pass, so
 * the catalog entries exist by the time the linker runs.
 *
 * ## What discovery now includes that it did not
 *
 * `*.gradle.kts` was never found at all. The scan matched `.gradle`, and
 * `build.gradle.kts` does not end in `.gradle`, so every Kotlin DSL build in
 * every corpus produced zero rows — silently, and despite the extractor
 * carrying several hundred lines of Kotlin-specific handling. Version catalogs
 * were not read either, which in a catalog-based build means every dependency
 * row had an alias and no coordinate.
 */
export class GradleProjectAnalyzer {
  private allScripts: GradleScript[] = [];
  private allBlocks: GradleBlock[] = [];
  private allDeclarations: GradleDeclaration[] = [];
  private allValueReferences: GradleValueReference[] = [];
  private allCoordinates: GradleDependencyCoordinate[] = [];
  private allCatalogEntries: GradleCatalogEntry[] = [];
  private allComments: GradleComment[] = [];
  private allParseGaps: GradleParseGap[] = [];
  private skippedFiles: SkippedGradleFile[] = [];

  private extractor: GradleFileExtractor;
  private catalogExtractor: GradleCatalogExtractor;
  private linker: GradleResolutionLinker;
  private outputDir: string;

  constructor(outputDir?: string) {
    this.extractor = new GradleFileExtractor();
    this.catalogExtractor = new GradleCatalogExtractor();
    this.linker = new GradleResolutionLinker();
    this.outputDir = outputDir || ANALYSIS_OUTPUT_DIR;
  }

  async analyzeGradleFiles(
    projects: ProjectInfo[],
    serviceVersionLink: string
  ): Promise<void> {
    const startTime = Date.now();

    console.log(`\n📊 Analyzing Gradle files across ${projects.length} project(s)\n`);

    if (projects.length === 0) {
      console.log('No projects found to analyze for Gradle files.');
      return;
    }

    const serviceVersionHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.SERVICE_VERSION,
      serviceVersionLink
    );

    await this.ensureOutputDirectory();

    // Discovery first, across every scan target at once, because the targets
    // overlap. See resolveOwnership.
    const owned = await this.discover(projects);

    // Settings directories are computed over the WHOLE corpus rather than per
    // target. A settings file and the subproject it includes can arrive from
    // two different scan targets, and a per-target set would classify the
    // subproject without knowing its settings file exists.
    const settingsDirs = new Set(
      [...owned.keys()]
        .filter((f) => GradleScriptClassifier.isSettingsFile(path.basename(f)))
        .map((f) => path.dirname(f))
    );

    console.log(`   🔍 ${owned.size} Gradle file(s), ${settingsDirs.size} settings root(s)`);

    // Catalogs first, so their entries exist before anything references them.
    const files = [...owned.keys()].sort();
    const catalogs = files.filter((f) => GradleScriptClassifier.isCatalogFile(path.basename(f)));
    const scripts = files.filter((f) => !GradleScriptClassifier.isCatalogFile(path.basename(f)));

    // One at a time: the extractor keeps per-file state and resets it at the
    // start of each extractScript call, so interleaving two files through it
    // would mix their rows together.
    for (const filePath of [...catalogs, ...scripts]) {
      await this.analyzeFile(filePath, owned.get(filePath)!, settingsDirs, serviceVersionHash);
    }

    // The project pass: everything one file could not decide alone.
    this.linker.link({
      scripts: this.allScripts,
      declarations: this.allDeclarations,
      valueReferences: this.allValueReferences,
      coordinates: this.allCoordinates,
      catalogEntries: this.allCatalogEntries,
    });

    await this.exportAll();

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n📊 Gradle scripts:              ${this.allScripts.length}`);
    console.log(`📊 Gradle blocks:               ${this.allBlocks.length}`);
    console.log(`📊 Gradle declarations:         ${this.allDeclarations.length}`);
    console.log(`📊 Gradle dependency coords:    ${this.allCoordinates.length}`);
    console.log(`📊 Gradle catalog entries:      ${this.allCatalogEntries.length}`);
    console.log(`📊 Gradle value references:     ${this.allValueReferences.length}`);
    console.log(`📊 Gradle comments:             ${this.allComments.length}`);
    console.log(`📊 Gradle parse gaps:           ${this.allParseGaps.length}`);
    console.log(`📊 Skipped Gradle files:        ${this.skippedFiles.length}`);
    console.log(`⏱️  Gradle analysis completed in ${durationSeconds}s`);
  }

  /**
   * Finds every Gradle file across all scan targets, once, and decides which
   * target owns each one.
   *
   * ## Why ownership has to be resolved rather than assumed
   *
   * The scan targets `extractProject` supplies OVERLAP by construction. It
   * prepends the repository root so root-level `settings.gradle` and `pom.xml`
   * are never missed, and then adds every project the scanner detected
   * underneath it. A file inside a detected project is therefore reachable
   * from two targets.
   *
   * Scanning per target independently analyses each such file twice. The two
   * rows are not even identical — `baseMservPath` differs, so they get
   * different keys and slip past a uniqueness check — and they can disagree:
   * a subproject build script was emitted once as PROJECT_BUILD and once as
   * SCRIPT_PLUGIN, because only one of the two could win the include edge.
   *
   * The most specific containing target wins, since that is the project the
   * file actually belongs to and therefore the correct `baseMservPath`.
   */
  private async discover(projects: ProjectInfo[]): Promise<Map<string, ProjectInfo>> {
    const owned = new Map<string, ProjectInfo>();

    for (const project of projects) {
      const files = await this.findGradleFiles(project.path);
      if (!files.length) continue;

      for (const filePath of files) {
        const current = owned.get(filePath);
        if (!current || this.isMoreSpecific(project, current)) {
          owned.set(filePath, project);
        }
      }
    }

    if (owned.size) {
      const names = [...new Set([...owned.values()].map((p) => p.name))];
      console.log(`📦 Gradle in: ${names.join(', ')}`);
    }
    return owned;
  }

  /** The deeper project path is the one the file really belongs to. */
  private isMoreSpecific(candidate: ProjectInfo, current: ProjectInfo): boolean {
    return path.resolve(candidate.path).length > path.resolve(current.path).length;
  }

  private async analyzeFile(
    filePath: string,
    project: ProjectInfo,
    settingsDirs: ReadonlySet<string>,
    serviceVersionHash: string
  ): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      console.error(`   ❌ Error reading Gradle ${filePath}:`, error);
      this.skip(filePath, project.path, serviceVersionHash, SkippedFileReason.READ_ERROR);
      return;
    }

    if (!content || content.trim().length === 0) {
      this.skip(filePath, project.path, serviceVersionHash, SkippedFileReason.EMPTY_CONTENT);
      return;
    }

    const identity = GradleScriptClassifier.classify(filePath, settingsDirs);
    const lineCount = content.split('\n').length;

    const script = GradleScript.builder(
      identity.scriptKind, identity.dialect, filePath, project.path, serviceVersionHash
    )
      .withGradleProjectPath(identity.gradleProjectPath)
      .withRelativePath(identity.relativePath)
      .withFileName(identity.fileName)
      .withLineCount(lineCount)
      .build();

    this.allScripts.push(script);

    // A file too large to parse still gets its script row and a gap saying so.
    // Dropping it entirely is what makes an unanalysed build indistinguishable
    // from an empty one.
    if (lineCount > LARGE_FILE_LINE_THRESHOLD) {
      console.log(`   ⏭️  Skipping very large file (${lineCount} lines): ${filePath}`);
      script.setParseStatus(GradleParseStatus.FAILED);
      this.allParseGaps.push(
        GradleParseGap.builder(
          GradleParseGapReason.FILE_TOO_LARGE, script.getHash(), filePath, project.path,
          1, lineCount, 0, 0, serviceVersionHash
        )
          .withNodeType('file')
          .withOriginalText(`${lineCount} lines exceeds the ${LARGE_FILE_LINE_THRESHOLD} line threshold`)
          .build()
      );
      script.setCounts({ blocks: 0, declarations: 0, valueReferences: 0, coordinates: 0, comments: 0, parseGaps: 1 });
      this.skip(filePath, project.path, serviceVersionHash, SkippedFileReason.FILE_TOO_LARGE);
      return;
    }

    if (identity.scriptKind === GradleScriptKind.VERSION_CATALOG) {
      this.analyzeCatalog(script, filePath, content, project.path, serviceVersionHash);
      return;
    }

    const result = this.extractor.extractScript(content, {
      filePath,
      baseMservPath: project.path,
      dialect: identity.dialect,
      scriptHash: script.getHash(),
      scriptKind: identity.scriptKind,
      serviceVersionHash,
    });

    this.allBlocks.push(...result.blocks);
    this.allDeclarations.push(...result.declarations);
    this.allValueReferences.push(...result.valueReferences);
    this.allCoordinates.push(...result.coordinates);
    this.allComments.push(...result.comments);
    this.allParseGaps.push(...result.parseGaps);

    script.setParseStatus(result.parseStatus);
    script.setCounts({
      blocks: result.blocks.length,
      declarations: result.declarations.length,
      valueReferences: result.valueReferences.length,
      coordinates: result.coordinates.length,
      comments: result.comments.length,
      parseGaps: result.parseGaps.length,
    });
  }

  private analyzeCatalog(
    script: GradleScript,
    filePath: string,
    content: string,
    baseMservPath: string,
    serviceVersionHash: string
  ): void {
    const result = this.catalogExtractor.extract(
      filePath, content, script.getHash(), baseMservPath, serviceVersionHash
    );

    this.allCatalogEntries.push(...result.entries);
    this.allParseGaps.push(...result.parseGaps);

    script.setParseStatus(result.parseGaps.length ? GradleParseStatus.PARTIAL : GradleParseStatus.OK);
    script.setCounts({
      blocks: 0, declarations: 0, valueReferences: 0,
      coordinates: result.entries.length, comments: 0,
      parseGaps: result.parseGaps.length,
    });
  }

  private skip(
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string,
    reason: SkippedFileReason
  ): void {
    this.skippedFiles.push({
      filePath,
      baseMservPath,
      serviceVersionHash,
      reason,
      uniqueFileHash: EntityUtils.generateEntityHash(
        ENTITY_IDENTIFIERS.SKIPPED_FILE,
        `${filePath}||${baseMservPath}||${serviceVersionHash}||${reason}`
      ),
    });
  }

  // ─── Discovery ───────────────────────────────────────────────

  private async findGradleFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    await this.scanForGradleFiles(dirPath, files);
    // Sorted so the emitted row order is a property of the corpus rather than
    // of the filesystem, which readdir does not promise to keep stable.
    return files.sort();
  }

  private async scanForGradleFiles(dirPath: string, files: string[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // `.gradle` is Gradle's own cache directory and holds generated
        // scripts that describe nothing about the project. It is excluded by
        // the leading-dot rule; `buildSrc` deliberately is NOT, because its
        // build script is a real fact about how the build is assembled.
        if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await this.scanForGradleFiles(path.join(dirPath, entry.name), files);
        }
      } else if (entry.isFile() && GradleScriptClassifier.isGradleFile(entry.name)) {
        files.push(path.join(dirPath, entry.name));
      }
    }
  }

  // ─── CSV Export ──────────────────────────────────────────────

  private async exportAll(): Promise<void> {
    await Promise.all([
      this.exportEntitiesToCsv(this.allScripts, OUTPUT_GRADLE_SCRIPT_CSV_FILENAME, 'Gradle scripts'),
      this.exportEntitiesToCsv(this.allBlocks, OUTPUT_GRADLE_BLOCK_CSV_FILENAME, 'Gradle blocks'),
      this.exportEntitiesToCsv(this.allDeclarations, OUTPUT_GRADLE_DECLARATION_CSV_FILENAME, 'Gradle declarations'),
      this.exportEntitiesToCsv(this.allCoordinates, OUTPUT_GRADLE_DEPENDENCY_COORDINATE_CSV_FILENAME, 'Gradle dependency coordinates'),
      this.exportEntitiesToCsv(this.allCatalogEntries, OUTPUT_GRADLE_CATALOG_ENTRY_CSV_FILENAME, 'Gradle catalog entries'),
      this.exportEntitiesToCsv(this.allValueReferences, OUTPUT_GRADLE_VALUE_REFERENCE_CSV_FILENAME, 'Gradle value references'),
      this.exportEntitiesToCsv(this.allComments, OUTPUT_GRADLE_COMMENT_CSV_FILENAME, 'Gradle comments'),
      this.exportEntitiesToCsv(this.allParseGaps, OUTPUT_GRADLE_PARSE_GAP_CSV_FILENAME, 'Gradle parse gaps'),
      this.exportSkippedFilesCsv(),
    ]);
  }

  private async exportEntitiesToCsv<T extends { getCsvHeader(): string; toCsv(): string }>(
    entities: T[],
    filename: string,
    entityTypeName: string
  ): Promise<void> {
    if (entities.length === 0) {
      console.log(`\n⚠️  No ${entityTypeName} to export`);
      return;
    }

    const outputPath = path.join(this.outputDir, filename);
    const firstEntity = entities[0];
    if (!firstEntity) return;

    const csvContent = [firstEntity.getCsvHeader(), ...entities.map((e) => e.toCsv())].join('\n');
    await fs.writeFile(outputPath, csvContent, 'utf-8');
    console.log(`💾 ${entityTypeName} CSV exported to: ${outputPath}`);
  }

  private async exportSkippedFilesCsv(): Promise<void> {
    if (this.skippedFiles.length === 0) return;

    const outputPath = path.join(this.outputDir, OUTPUT_SKIPPED_GRADLE_FILES_CSV_FILENAME);
    const header = 'filePath\tbaseMservPath\tserviceVersionHash\treason\tuniqueFileHash';
    const rows = this.skippedFiles.map(
      (f) => `${f.filePath}\t${f.baseMservPath}\t${f.serviceVersionHash}\t${f.reason}\t${f.uniqueFileHash}`
    );
    await fs.writeFile(outputPath, [header, ...rows].join('\n'), 'utf-8');
    console.log(`💾 Skipped Gradle files CSV exported to: ${outputPath}`);
  }

  private async ensureOutputDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error(`Error creating output directory: ${error}`);
    }
  }
}
