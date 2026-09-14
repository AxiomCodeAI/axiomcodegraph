import * as fs from 'fs/promises';
import * as path from 'path';

import { PropertyKey } from '@/analysis-types/properties/PropertyKey';
import { PropertyValueSegment } from '@/analysis-types/properties/PropertyValueSegment';
import { EXCLUDED_DIRS, ANALYSIS_OUTPUT_DIR, OUTPUT_PROPERTY_KEY_CSV_FILENAME, OUTPUT_PROPERTY_VALUE_SEGMENT_CSV_FILENAME, OUTPUT_SKIPPED_PROPERTIES_FILES_CSV_FILENAME, FILE_EXTENSIONS, LARGE_FILE_LINE_THRESHOLD } from '@/constants/consts';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { PropertiesParser } from '@/parsers/properties/properties-parser';
import { ProjectInfo } from '@/types/ProjectInfo';
import { EntityUtils } from '@/utils/entity-utils';
import { groupOwnedFiles, resolveFileOwners } from '@/utils/file-ownership';

/**
 * Analyzes .properties files within Java projects and extracts
 * PropertyKey and PropertyValueSegment entities to CSV.
 */
export class PropertiesProjectAnalyzer {
  private allPropertyKeys: PropertyKey[] = [];
  private allValueSegments: PropertyValueSegment[] = [];
  private skippedFiles: { filePath: string; baseMservPath: string; serviceVersionHash: string; reason: SkippedFileReason; uniqueFileHash: string }[] = [];
  private parser: PropertiesParser;
  private outputDir: string;

  constructor(outputDir?: string) {
    this.parser = new PropertiesParser();
    this.outputDir = outputDir || ANALYSIS_OUTPUT_DIR;
  }

  /**
   * Analyzes .properties files across all provided Java projects.
   *
   * @param javaProjects Array of Java projects to scan for .properties files
   * @param serviceVersionLink Service version identifier string
   */
  async analyzePropertiesFiles(
    javaProjects: ProjectInfo[],
    serviceVersionLink: string
  ): Promise<void> {
    const startTime = Date.now();

    const serviceVersionHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.SERVICE_VERSION,
      serviceVersionLink
    );

    await this.ensureOutputDirectory();

    await Promise.all(
      [...groupOwnedFiles(
        await resolveFileOwners(javaProjects, (root) => this.findPropertiesFiles(root))
      )].map(([project, files]) => this.analyzeProject(project, files, serviceVersionHash))
    );

    await this.exportPropertyKeysCsv();
    await this.exportValueSegmentsCsv();
    await this.exportSkippedFilesCsv();

    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n📊 Total property keys extracted: ${this.allPropertyKeys.length}`);
    console.log(`📊 Total value segments extracted: ${this.allValueSegments.length}`);
    console.log(`⏱️  Properties analysis completed in ${durationSeconds}s`);
  }

  /**
   * Analyzes the files attributed to a single project.
   */
  private async analyzeProject(
    project: ProjectInfo,
    propertiesFiles: ReadonlyArray<string>,
    serviceVersionHash: string
  ): Promise<void> {
    if (propertiesFiles.length === 0) {
      return;
    }

    console.log(`\n📦 Properties in: ${project.name}`);
    console.log(`   🔍 Found ${propertiesFiles.length} .properties file(s)`);

    for (const filePath of propertiesFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        if (!content || content.trim().length === 0) {
          const reason = SkippedFileReason.EMPTY_CONTENT;
          const uniqueFileHash = EntityUtils.generateEntityHash(
            ENTITY_IDENTIFIERS.SKIPPED_FILE,
            `${filePath}||${project.path}||${serviceVersionHash}||${reason}`
          );
          this.skippedFiles.push({ filePath, baseMservPath: project.path, serviceVersionHash, reason, uniqueFileHash });
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

        const [keys, segments] = this.parser.parse(
          content,
          filePath,
          project.path,
          serviceVersionHash
        );

        this.allPropertyKeys.push(...keys);
        this.allValueSegments.push(...segments);

      } catch (error) {
        console.error(`   ❌ Error parsing ${filePath}:`, error);
      }
    }
  }

  /**
   * Recursively finds all .properties files in a directory.
   */
  private async findPropertiesFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    await this.scanForPropertiesFiles(dirPath, files);
    return files;
  }

  private async scanForPropertiesFiles(dirPath: string, files: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            const subPath = path.join(dirPath, entry.name);
            await this.scanForPropertiesFiles(subPath, files);
          }
        } else if (entry.isFile() && entry.name.endsWith(FILE_EXTENSIONS.PROPERTIES)) {
          files.push(path.join(dirPath, entry.name));
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }
  }

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

  private async exportPropertyKeysCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allPropertyKeys,
      OUTPUT_PROPERTY_KEY_CSV_FILENAME,
      'Property keys'
    );
  }

  private async exportValueSegmentsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allValueSegments,
      OUTPUT_PROPERTY_VALUE_SEGMENT_CSV_FILENAME,
      'Property value segments'
    );
  }

  private async exportSkippedFilesCsv(): Promise<void> {
    if (this.skippedFiles.length === 0) return;

    const outputPath = path.join(this.outputDir, OUTPUT_SKIPPED_PROPERTIES_FILES_CSV_FILENAME);
    const header = 'filePath\tbaseMservPath\tserviceVersionHash\treason\tuniqueFileHash';
    const rows = this.skippedFiles.map(
      (f) => `${f.filePath}\t${f.baseMservPath}\t${f.serviceVersionHash}\t${f.reason}\t${f.uniqueFileHash}`
    );
    const csvContent = [header, ...rows].join('\n');

    await fs.writeFile(outputPath, csvContent, 'utf-8');
    console.log(`💾 Skipped Properties files CSV exported to: ${outputPath}`);
  }

  private async ensureOutputDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error(`Error creating output directory: ${error}`);
    }
  }
}
