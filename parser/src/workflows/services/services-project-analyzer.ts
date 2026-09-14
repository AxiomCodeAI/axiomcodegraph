import * as fs from 'fs/promises';
import * as path from 'path';

import { ServiceDescriptor } from '@/analysis-types/services/ServiceDescriptor';
import { ServiceProvider } from '@/analysis-types/services/ServiceProvider';
import {
  ANALYSIS_OUTPUT_DIR,
  EXCLUDED_DIRS,
  LARGE_FILE_LINE_THRESHOLD,
  META_INF_DIR,
  OUTPUT_SERVICE_DESCRIPTOR_CSV_FILENAME,
  OUTPUT_SERVICE_PROVIDER_CSV_FILENAME,
  OUTPUT_SKIPPED_SERVICES_FILES_CSV_FILENAME,
  SERVICES_DIR,
} from '@/constants/consts';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { ServicesParser } from '@/parsers/services/services-parser';
import { ProjectInfo } from '@/types/ProjectInfo';
import { EntityUtils } from '@/utils/entity-utils';

interface SkippedServicesFile {
  filePath: string;
  baseMservPath: string;
  serviceVersionHash: string;
  reason: SkippedFileReason;
  uniqueFileHash: string;
}

/**
 * Extracts `META-INF/services` provider-configuration files across a codebase.
 *
 * ## Why one file is attributed to exactly one project
 *
 * The scan targets handed to a file-type analyzer can NEST: when the repository
 * root is not itself a detected project it is added as its own target alongside
 * every project found beneath it, so a walk of the root re-reaches the same
 * files as a walk of each project. Emitting a row per (file, target) pair
 * doubles the population and makes any count over the relation wrong rather
 * than merely incomplete, so each file is attributed here to the MOST SPECIFIC
 * target that contains it — the enclosing project rather than the repository
 * root — and emitted once.
 */
export class ServicesProjectAnalyzer {
  private allDescriptors: ServiceDescriptor[] = [];
  private allProviders: ServiceProvider[] = [];
  private skippedFiles: SkippedServicesFile[] = [];
  private parser: ServicesParser;
  private outputDir: string;

  constructor(outputDir?: string) {
    this.parser = new ServicesParser();
    this.outputDir = outputDir || ANALYSIS_OUTPUT_DIR;
  }

  /**
   * Analyses every `META-INF/services` file reachable from the given targets.
   *
   * @param projects Scan targets (may nest; see the class comment)
   * @param serviceVersionLink Service version identifier string
   */
  async analyzeServicesFiles(
    projects: ProjectInfo[],
    serviceVersionLink: string
  ): Promise<void> {
    const startTime = Date.now();

    const serviceVersionHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.SERVICE_VERSION,
      serviceVersionLink
    );

    await this.ensureOutputDirectory();

    const owners = await this.resolveFileOwners(projects);

    for (const [filePath, baseMservPath] of owners) {
      await this.analyzeFile(filePath, baseMservPath, serviceVersionHash);
    }

    await this.exportDescriptorsCsv();
    await this.exportProvidersCsv();
    await this.exportSkippedFilesCsv();

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n📊 Total service descriptors extracted: ${this.allDescriptors.length}`);
    console.log(`📊 Total service providers extracted: ${this.allProviders.length}`);
    console.log(`⏱️  Services analysis completed in ${durationSeconds}s`);
  }

  getDescriptors(): ReadonlyArray<ServiceDescriptor> {
    return this.allDescriptors;
  }

  getProviders(): ReadonlyArray<ServiceProvider> {
    return this.allProviders;
  }

  /**
   * Maps every discovered file to the single project it is attributed to.
   *
   * The winner is the target with the longest path containing the file, so a
   * file inside `repo/core` is attributed to `repo/core` and not to `repo`.
   */
  private async resolveFileOwners(projects: ProjectInfo[]): Promise<Map<string, string>> {
    const owners = new Map<string, string>();

    for (const project of projects) {
      const files = await this.findServicesFiles(project.path);
      for (const filePath of files) {
        const current = owners.get(filePath);
        if (current === undefined || project.path.length > current.length) {
          owners.set(filePath, project.path);
        }
      }
    }

    return owners;
  }

  private async analyzeFile(
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string
  ): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      console.error(`   ❌ Error reading ${filePath}:`, error);
      this.recordSkip(filePath, baseMservPath, serviceVersionHash, SkippedFileReason.READ_ERROR);
      return;
    }

    if (content.split('\n').length > LARGE_FILE_LINE_THRESHOLD) {
      this.recordSkip(filePath, baseMservPath, serviceVersionHash, SkippedFileReason.FILE_TOO_LARGE);
      return;
    }

    try {
      // An empty file, or one holding nothing but a licence header, is NOT
      // skipped. It is a well-formed descriptor that declares zero providers —
      // a real and meaningful statement — and recording it as a skipped file
      // would make "no providers declared" indistinguishable from "not read".
      const [descriptor, providers] = this.parser.parse(
        content,
        filePath,
        baseMservPath,
        serviceVersionHash
      );
      this.allDescriptors.push(descriptor);
      this.allProviders.push(...providers);
    } catch (error) {
      console.error(`   ❌ Error parsing ${filePath}:`, error);
      this.recordSkip(
        filePath,
        baseMservPath,
        serviceVersionHash,
        SkippedFileReason.EXTRACTION_ERROR
      );
    }
  }

  private recordSkip(
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string,
    reason: SkippedFileReason
  ): void {
    const uniqueFileHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.SKIPPED_FILE,
      `${filePath}||${baseMservPath}||${serviceVersionHash}||${reason}`
    );
    this.skippedFiles.push({
      filePath,
      baseMservPath,
      serviceVersionHash,
      reason,
      uniqueFileHash,
    });
  }

  /**
   * Finds every direct child of a `META-INF/services` directory beneath a root.
   *
   * The directory pair is matched on the way down rather than by testing each
   * file's path, so the walk never descends into `META-INF/services` looking for
   * source files and never treats a file named `services` as a directory.
   */
  private async findServicesFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    await this.scan(dirPath, files);
    return files;
  }

  private async scan(dirPath: string, files: string[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const subPath = path.join(dirPath, entry.name);

      if (entry.name === META_INF_DIR) {
        await this.collectProviderFiles(path.join(subPath, SERVICES_DIR), files);
        // A `META-INF` directory holds resources, never a nested project, so
        // there is nothing else beneath it to look for.
        continue;
      }

      if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }

      await this.scan(subPath, files);
    }
  }

  private async collectProviderFiles(servicesDir: string, files: string[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(servicesDir, { withFileTypes: true });
    } catch {
      // No `services` directory under this `META-INF`, which is the common case.
      return;
    }

    for (const entry of entries) {
      if (entry.isFile()) {
        files.push(path.join(servicesDir, entry.name));
      }
    }
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

    const header = firstEntity.getCsvHeader();
    const rows = entities.map((entity) => entity.toCsv());
    await fs.writeFile(outputPath, [header, ...rows].join('\n'), 'utf-8');
    console.log(`💾 ${entityTypeName} CSV exported to: ${outputPath}`);
  }

  private async exportDescriptorsCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allDescriptors,
      OUTPUT_SERVICE_DESCRIPTOR_CSV_FILENAME,
      'Service descriptors'
    );
  }

  private async exportProvidersCsv(): Promise<void> {
    await this.exportEntitiesToCsv(
      this.allProviders,
      OUTPUT_SERVICE_PROVIDER_CSV_FILENAME,
      'Service providers'
    );
  }

  private async exportSkippedFilesCsv(): Promise<void> {
    if (this.skippedFiles.length === 0) return;

    const outputPath = path.join(this.outputDir, OUTPUT_SKIPPED_SERVICES_FILES_CSV_FILENAME);
    const header = 'filePath\tbaseMservPath\tserviceVersionHash\treason\tuniqueFileHash';
    const rows = this.skippedFiles.map(
      (f) => `${f.filePath}\t${f.baseMservPath}\t${f.serviceVersionHash}\t${f.reason}\t${f.uniqueFileHash}`
    );
    await fs.writeFile(outputPath, [header, ...rows].join('\n'), 'utf-8');
    console.log(`💾 Skipped services files CSV exported to: ${outputPath}`);
  }

  private async ensureOutputDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error(`Error creating output directory: ${error}`);
    }
  }
}
