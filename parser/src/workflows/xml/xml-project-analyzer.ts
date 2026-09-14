import * as fs from 'fs/promises';
import * as path from 'path';

import { XmlAttribute } from '@/analysis-types/xml/XmlAttribute';
import { XmlElement } from '@/analysis-types/xml/XmlElement';
import { XmlValueReference } from '@/analysis-types/xml/XmlValueReference';
import { EXCLUDED_DIRS, ANALYSIS_OUTPUT_DIR, OUTPUT_XML_ELEMENT_CSV_FILENAME, OUTPUT_XML_ATTRIBUTE_CSV_FILENAME, OUTPUT_XML_VALUE_REFERENCE_CSV_FILENAME, OUTPUT_SKIPPED_XML_FILES_CSV_FILENAME, FILE_EXTENSIONS, LARGE_FILE_LINE_THRESHOLD } from '@/constants/consts';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { XmlParser } from '@/parsers/xml/xml-parser';
import { ProjectInfo } from '@/types/ProjectInfo';
import { EntityUtils } from '@/utils/entity-utils';
import { groupOwnedFiles, resolveFileOwners } from '@/utils/file-ownership';

/**
 * Analyzes XML files within projects and extracts
 * XmlElement, XmlAttribute, and XmlValueReference entities to CSV.
 *
 * Handles any XML file including pom.xml, Spring context XML,
 * persistence.xml, web.xml, Hibernate configs, etc.
 */
export class XmlProjectAnalyzer {
  private allElements: XmlElement[] = [];
  private allAttributes: XmlAttribute[] = [];
  private allValueReferences: XmlValueReference[] = [];
  private skippedFiles: { filePath: string; baseMservPath: string; serviceVersionHash: string; reason: SkippedFileReason; uniqueFileHash: string }[] = [];
  private parser: XmlParser;
  private outputDir: string;

  constructor(outputDir?: string) {
    this.parser = new XmlParser();
    this.outputDir = outputDir || ANALYSIS_OUTPUT_DIR;
  }

  /**
   * Analyzes XML files across all provided projects.
   *
   * @param projects Array of projects to scan for XML files
   * @param serviceVersionLink Service version identifier string
   */
  async analyzeXmlFiles(
    projects: ProjectInfo[],
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
        await resolveFileOwners(projects, (root) => this.findXmlFiles(root))
      )].map(([project, files]) => this.analyzeProject(project, files, serviceVersionHash))
    );

    await this.exportElementsCsv();
    await this.exportAttributesCsv();
    await this.exportValueReferencesCsv();
    await this.exportSkippedFilesCsv();

    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n📊 Total XML elements extracted: ${this.allElements.length}`);
    console.log(`📊 Total XML attributes extracted: ${this.allAttributes.length}`);
    console.log(`📊 Total XML value references extracted: ${this.allValueReferences.length}`);
    console.log(`⏱️  XML analysis completed in ${durationSeconds}s`);
  }

  /**
   * Analyzes the files attributed to a single project.
   */
  private async analyzeProject(
    project: ProjectInfo,
    xmlFiles: ReadonlyArray<string>,
    serviceVersionHash: string
  ): Promise<void> {
    if (xmlFiles.length === 0) {
      return;
    }

    console.log(`\n📦 XML in: ${project.name}`);
    console.log(`   🔍 Found ${xmlFiles.length} .xml file(s)`);

    for (const filePath of xmlFiles) {
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

        const [elements, attributes, valueRefs] = this.parser.parse(
          content,
          filePath,
          project.path,
          serviceVersionHash
        );

        this.allElements.push(...elements);
        this.allAttributes.push(...attributes);
        this.allValueReferences.push(...valueRefs);

      } catch (error) {
        console.error(`   ❌ Error parsing XML ${filePath}:`, error);
      }
    }
  }

  /**
   * Recursively finds all .xml files in a directory.
   */
  private async findXmlFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    await this.scanForXmlFiles(dirPath, files);
    return files;
  }

  private async scanForXmlFiles(dirPath: string, files: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            const subPath = path.join(dirPath, entry.name);
            await this.scanForXmlFiles(subPath, files);
          }
        } else if (entry.isFile() && entry.name.endsWith(FILE_EXTENSIONS.XML)) {
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

  private async exportElementsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allElements,
      OUTPUT_XML_ELEMENT_CSV_FILENAME,
      'XML elements'
    );
  }

  private async exportAttributesCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allAttributes,
      OUTPUT_XML_ATTRIBUTE_CSV_FILENAME,
      'XML attributes'
    );
  }

  private async exportValueReferencesCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allValueReferences,
      OUTPUT_XML_VALUE_REFERENCE_CSV_FILENAME,
      'XML value references'
    );
  }

  private async exportSkippedFilesCsv(): Promise<void> {
    if (this.skippedFiles.length === 0) return;

    const outputPath = path.join(this.outputDir, OUTPUT_SKIPPED_XML_FILES_CSV_FILENAME);
    const header = 'filePath\tbaseMservPath\tserviceVersionHash\treason\tuniqueFileHash';
    const rows = this.skippedFiles.map(
      (f) => `${f.filePath}\t${f.baseMservPath}\t${f.serviceVersionHash}\t${f.reason}\t${f.uniqueFileHash}`
    );
    const csvContent = [header, ...rows].join('\n');

    await fs.writeFile(outputPath, csvContent, 'utf-8');
    console.log(`💾 Skipped XML files CSV exported to: ${outputPath}`);
  }

  private async ensureOutputDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error(`Error creating output directory: ${error}`);
    }
  }
}
