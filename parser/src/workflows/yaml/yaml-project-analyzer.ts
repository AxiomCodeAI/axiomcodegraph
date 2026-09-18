import * as fs from 'fs/promises';
import * as path from 'path';

import { YamlProperty } from '@/analysis-types/yaml/YamlProperty';
import { YamlValueSegment } from '@/analysis-types/yaml/YamlValueSegment';
import { EXCLUDED_DIRS, ANALYSIS_OUTPUT_DIR, OUTPUT_YAML_PROPERTY_CSV_FILENAME, OUTPUT_YAML_VALUE_SEGMENT_CSV_FILENAME, OUTPUT_SKIPPED_YAML_FILES_CSV_FILENAME, FILE_EXTENSIONS, LARGE_FILE_LINE_THRESHOLD, LARGE_FILE_BYTE_THRESHOLD } from '@/constants/consts';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { YamlParser } from '@/parsers/yaml/yaml-parser';
import { ProjectInfo } from '@/types/ProjectInfo';
import { EntityUtils } from '@/utils/entity-utils';
import { groupOwnedFiles, resolveFileOwners } from '@/utils/file-ownership';

/**
 * Analyzes YAML files (.yml / .yaml) within Java projects and extracts
 * YamlProperty and YamlValueSegment entities to CSV.
 */
export class YamlProjectAnalyzer {
  private allProperties: YamlProperty[] = [];
  private allSegments: YamlValueSegment[] = [];
  private skippedFiles: { filePath: string; baseMservPath: string; serviceVersionHash: string; reason: SkippedFileReason; uniqueFileHash: string }[] = [];
  private parser: YamlParser;
  private outputDir: string;

  constructor(outputDir?: string) {
    this.parser = new YamlParser();
    this.outputDir = outputDir || ANALYSIS_OUTPUT_DIR;
  }

  /**
   * Analyzes YAML files across all provided Java projects.
   *
   * @param javaProjects Array of Java projects to scan for YAML files
   * @param serviceVersionLink Service version identifier string
   */
  async analyzeYamlFiles(
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
        await resolveFileOwners(javaProjects, (root) => this.findYamlFiles(root))
      )].map(([project, files]) => this.analyzeProject(project, files, serviceVersionHash))
    );

    await this.exportPropertiesCsv();
    await this.exportSegmentsCsv();
    await this.exportSkippedFilesCsv();

    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n📊 Total YAML properties extracted: ${this.allProperties.length}`);
    console.log(`📊 Total YAML value segments extracted: ${this.allSegments.length}`);
    console.log(`⏱️  YAML analysis completed in ${durationSeconds}s`);
  }

  /**
   * Analyzes the files attributed to a single project.
   */
  private async analyzeProject(
    project: ProjectInfo,
    yamlFiles: ReadonlyArray<string>,
    serviceVersionHash: string
  ): Promise<void> {
    if (yamlFiles.length === 0) {
      return;
    }

    console.log(`\n📦 YAML in: ${project.name}`);
    console.log(`   🔍 Found ${yamlFiles.length} .yml/.yaml file(s)`);

    for (const filePath of yamlFiles) {
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

        // BYTES first: a machine-generated file is routinely megabytes on a few
        // hundred lines, so the line guard below never sees it and the extractor
        // overflows the stack instead (#554). Recorded as a skip like any other.
        const byteLength = Buffer.byteLength(content, 'utf-8');
        if (byteLength > LARGE_FILE_BYTE_THRESHOLD) {
          console.log(`   ⏭️  Skipping very large file (${byteLength} bytes): ${filePath}`);
          const reason = SkippedFileReason.FILE_TOO_LARGE;
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

        const [properties, segments] = this.parser.parse(
          content,
          filePath,
          project.path,
          serviceVersionHash
        );

        this.allProperties.push(...properties);
        this.allSegments.push(...segments);

      } catch (error) {
        // RECORD IT. Both guards above push a skippedFiles row and this one used to
        // log and return, so a file the extractor THREW on contributed no rows and
        // nothing anywhere said why (#554). The common shape is a machine-generated
        // file that is large in BYTES and short in LINES: it passes the line
        // threshold and then overflows the stack, so the corpus loses it silently.
        //
        // EXTRACTION_ERROR rather than READ_ERROR, which the enum is explicit about:
        // the environment did not fail, the parser did, and filing the second as the
        // first is how a crash in every file of a corpus produces an empty relation
        // and a run that still reports success.
        console.error(`   ❌ Error parsing ${filePath}:`, error);
        const reason = SkippedFileReason.EXTRACTION_ERROR;
        const uniqueFileHash = EntityUtils.generateEntityHash(
          ENTITY_IDENTIFIERS.SKIPPED_FILE,
          `${filePath}||${project.path}||${serviceVersionHash}||${reason}`
        );
        this.skippedFiles.push({ filePath, baseMservPath: project.path, serviceVersionHash, reason, uniqueFileHash });
      }
    }
  }

  /**
   * Recursively finds all YAML files in a directory.
   */
  private async findYamlFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    await this.scanForYamlFiles(dirPath, files);
    return files;
  }

  private async scanForYamlFiles(dirPath: string, files: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            const subPath = path.join(dirPath, entry.name);
            await this.scanForYamlFiles(subPath, files);
          }
        } else if (
          entry.isFile() &&
          (entry.name.endsWith(FILE_EXTENSIONS.YAML) || entry.name.endsWith(FILE_EXTENSIONS.YAML_LONG))
        ) {
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

    // Write in chunks to avoid RangeError: Invalid string length on large datasets
    const CHUNK_SIZE = 50_000;
    const header = firstEntity.getCsvHeader();
    await fs.writeFile(outputPath, header + '\n', 'utf-8');

    for (let i = 0; i < entities.length; i += CHUNK_SIZE) {
      const chunk = entities.slice(i, i + CHUNK_SIZE);
      const chunkContent = chunk.map((entity) => entity.toCsv()).join('\n') + '\n';
      await fs.appendFile(outputPath, chunkContent, 'utf-8');
    }

    console.log(`💾 ${entityTypeName} CSV exported to: ${outputPath}`);
  }

  private async exportPropertiesCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allProperties,
      OUTPUT_YAML_PROPERTY_CSV_FILENAME,
      'YAML properties'
    );
  }

  private async exportSegmentsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allSegments,
      OUTPUT_YAML_VALUE_SEGMENT_CSV_FILENAME,
      'YAML value segments'
    );
  }

  private async exportSkippedFilesCsv(): Promise<void> {
    if (this.skippedFiles.length === 0) return;

    const outputPath = path.join(this.outputDir, OUTPUT_SKIPPED_YAML_FILES_CSV_FILENAME);
    const header = 'filePath\tbaseMservPath\tserviceVersionHash\treason\tuniqueFileHash';
    const rows = this.skippedFiles.map(
      (f) => `${f.filePath}\t${f.baseMservPath}\t${f.serviceVersionHash}\t${f.reason}\t${f.uniqueFileHash}`
    );
    const csvContent = [header, ...rows].join('\n');

    await fs.writeFile(outputPath, csvContent, 'utf-8');
    console.log(`💾 Skipped YAML files CSV exported to: ${outputPath}`);
  }

  private async ensureOutputDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error(`Error creating output directory: ${error}`);
    }
  }
}
