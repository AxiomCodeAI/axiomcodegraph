import * as fs from 'fs/promises';
import * as path from 'path';

import { GradleBlock } from '@/analysis-types/gradle/GradleBlock';
import { GradleDeclaration } from '@/analysis-types/gradle/GradleDeclaration';
import { GradleValueReference } from '@/analysis-types/gradle/GradleValueReference';
import { EXCLUDED_DIRS, ANALYSIS_OUTPUT_DIR, OUTPUT_GRADLE_BLOCK_CSV_FILENAME, OUTPUT_GRADLE_DECLARATION_CSV_FILENAME, OUTPUT_GRADLE_VALUE_REFERENCE_CSV_FILENAME, OUTPUT_SKIPPED_GRADLE_FILES_CSV_FILENAME, FILE_EXTENSIONS, LARGE_FILE_LINE_THRESHOLD } from '@/constants/consts';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { GradleFileExtractor } from '@/parsers/gradle/extractors/gradle-file-extractor';
import { ProjectInfo } from '@/types/ProjectInfo';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Analyzes Gradle build files within projects and extracts
 * GradleBlock, GradleDeclaration, and GradleValueReference entities to CSV.
 *
 * Handles .gradle (Groovy DSL) files. Follows the same workflow pattern
 * as JavaProjectAnalyzer and XmlProjectAnalyzer.
 */
export class GradleProjectAnalyzer {
  private allBlocks: GradleBlock[] = [];
  private allDeclarations: GradleDeclaration[] = [];
  private allValueReferences: GradleValueReference[] = [];
  private skippedFiles: { filePath: string; baseMservPath: string; serviceVersionHash: string; reason: SkippedFileReason; uniqueFileHash: string }[] = [];
  private extractor: GradleFileExtractor;
  private outputDir: string;

  constructor(outputDir?: string) {
    this.extractor = new GradleFileExtractor();
    this.outputDir = outputDir || ANALYSIS_OUTPUT_DIR;
  }

  /**
   * Analyzes Gradle files across all provided projects.
   *
   * @param projects Array of projects to scan for Gradle files
   * @param serviceVersionLink Service version identifier string
   */
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

    await Promise.all(
      projects.map((project) => this.analyzeProject(project, serviceVersionHash))
    );

    await this.exportBlocksCsv();
    await this.exportDeclarationsCsv();
    await this.exportValueReferencesCsv();
    await this.exportSkippedFilesCsv();

    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n📊 Total Gradle blocks extracted: ${this.allBlocks.length}`);
    console.log(`📊 Total Gradle declarations extracted: ${this.allDeclarations.length}`);
    console.log(`📊 Total Gradle value references extracted: ${this.allValueReferences.length}`);
    console.log(`📊 Total skipped Gradle files: ${this.skippedFiles.length}`);
    console.log(`⏱️  Gradle analysis completed in ${durationSeconds}s`);
  }

  /**
   * Analyzes a single project for Gradle files.
   */
  private async analyzeProject(
    project: ProjectInfo,
    serviceVersionHash: string
  ): Promise<void> {
    const gradleFiles = await this.findGradleFiles(project.path);

    if (gradleFiles.length === 0) {
      return;
    }

    console.log(`📦 Gradle in: ${project.name}`);
    console.log(`   🔍 Found ${gradleFiles.length} .gradle file(s)`);

    for (const filePath of gradleFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');

        if (!content || content.trim().length === 0) {
          const reason = SkippedFileReason.EMPTY_CONTENT as SkippedFileReason;
          const uniqueFileHash = EntityUtils.generateEntityHash(
            ENTITY_IDENTIFIERS.SKIPPED_FILE,
            `${filePath}||${project.path}||${serviceVersionHash}||${reason}`
          );
          this.skippedFiles.push({
            filePath,
            baseMservPath: project.path,
            serviceVersionHash,
            reason,
            uniqueFileHash,
          });
          continue;
        }

        const lineCount = content.split('\n').length;
        if (lineCount > LARGE_FILE_LINE_THRESHOLD) {
          console.log(`   ⏭️  Skipping very large file (${lineCount} lines): ${filePath}`);
          const reason = SkippedFileReason.FILE_TOO_LARGE;
          const uniqueFileHash = EntityUtils.generateEntityHash(
            ENTITY_IDENTIFIERS.SKIPPED_FILE,
            `${filePath}||${project.path}||${serviceVersionHash}||${reason}`
          );
          this.skippedFiles.push({ filePath, baseMservPath: project.path, serviceVersionHash, reason, uniqueFileHash });
          continue;
        }

        // Extract blocks (primary entity)
        const blocks = this.extractor.extract(filePath, content, serviceVersionHash);
        this.allBlocks.push(...blocks);

        // Collect declarations from this file
        const declarations = this.extractor.getExtractedDeclarations();
        this.allDeclarations.push(...declarations);

        // Collect value references from this file
        const valueRefs = this.extractor.getExtractedValueReferences();
        this.allValueReferences.push(...valueRefs);

      } catch (error) {
        console.error(`   ❌ Error parsing Gradle ${filePath}:`, error);
        const reason = SkippedFileReason.READ_ERROR;
        const uniqueFileHash = EntityUtils.generateEntityHash(
          ENTITY_IDENTIFIERS.SKIPPED_FILE,
          `${filePath}||${project.path}||${serviceVersionHash}||${reason}`
        );
        this.skippedFiles.push({
          filePath,
          baseMservPath: project.path,
          serviceVersionHash,
          reason,
          uniqueFileHash,
        });
      }
    }

    console.log(`   ✅ Extracted ${this.allBlocks.length} blocks, ${this.allDeclarations.length} declarations`);
  }

  /**
   * Recursively finds all .gradle files in a directory.
   */
  private async findGradleFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    await this.scanForGradleFiles(dirPath, files);
    return files;
  }

  private async scanForGradleFiles(dirPath: string, files: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            const subPath = path.join(dirPath, entry.name);
            await this.scanForGradleFiles(subPath, files);
          }
        } else if (entry.isFile() && entry.name.endsWith(FILE_EXTENSIONS.GRADLE)) {
          files.push(path.join(dirPath, entry.name));
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }
  }

  // ─── CSV Export ──────────────────────────────────────────────

  /**
   * Generic CSV export helper.
   */
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

    const header = firstEntity.getCsvHeader();
    const rows = entities.map((entity) => entity.toCsv());
    const csvContent = [header, ...rows].join('\n');

    await fs.writeFile(outputPath, csvContent, 'utf-8');
    console.log(`💾 ${entityTypeName} CSV exported to: ${outputPath}`);
  }

  private async exportBlocksCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allBlocks,
      OUTPUT_GRADLE_BLOCK_CSV_FILENAME,
      'Gradle blocks'
    );
  }

  private async exportDeclarationsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allDeclarations,
      OUTPUT_GRADLE_DECLARATION_CSV_FILENAME,
      'Gradle declarations'
    );
  }

  private async exportValueReferencesCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allValueReferences,
      OUTPUT_GRADLE_VALUE_REFERENCE_CSV_FILENAME,
      'Gradle value references'
    );
  }

  private async exportSkippedFilesCsv(): Promise<void> {
    if (this.skippedFiles.length === 0) {
      return;
    }

    const outputPath = path.join(this.outputDir, OUTPUT_SKIPPED_GRADLE_FILES_CSV_FILENAME);
    const header = 'filePath\tbaseMservPath\tserviceVersionHash\treason\tuniqueFileHash';
    const rows = this.skippedFiles.map(
      (f) => `${f.filePath}\t${f.baseMservPath}\t${f.serviceVersionHash}\t${f.reason}\t${f.uniqueFileHash}`
    );
    const csvContent = [header, ...rows].join('\n');

    await fs.writeFile(outputPath, csvContent, 'utf-8');
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
