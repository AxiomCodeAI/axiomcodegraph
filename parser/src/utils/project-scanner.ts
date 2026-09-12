import * as fs from 'fs/promises';
import * as path from 'path';

import { EXCLUDED_DIRS } from '@/constants/consts';
import { ProjectInfo, ProjectLanguage } from '@/types/ProjectInfo';
import { ProjectDetector } from '@/utils/project-detector';

export class ProjectScanner {
  private detector: ProjectDetector;

  constructor(detector?: ProjectDetector) {
    this.detector = detector || new ProjectDetector();
  }

  /**
   * Scans a directory for projects recursively
   * @param rootPath Root directory to scan
   * @param maxDepth Maximum depth to scan (default: 3)
   */
  async scanForProjects(rootPath: string, maxDepth: number = 3): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = [];
    await this.scanDirectory(rootPath, projects, 0, maxDepth, new Set());
    return projects;
  }

  /**
   * Recursively scans directories for projects.
   *
   * Descends past a match rather than stopping at one. Stopping was what made a
   * polyglot repository report a single language: a parent `pom.xml` claimed the
   * whole tree as one Java project and the Python and TypeScript services beside
   * it were never discovered, so their analyzers received an empty project list
   * and wrote nothing. The same tree without that one POM extracted all three.
   *
   * `claimed` carries the languages an ancestor already covers. Every analyzer
   * walks its root recursively, so an ancestor claiming Java will reach this
   * directory's Java anyway; recording it again would parse the same files twice
   * and emit every row twice. Suppressing those keeps single-language repositories
   * behaving exactly as before — one project at the outermost match — while
   * letting a language no ancestor claimed be found at any depth.
   */
  private async scanDirectory(
    dirPath: string,
    projects: ProjectInfo[],
    currentDepth: number,
    maxDepth: number,
    claimed: ReadonlySet<ProjectLanguage>
  ): Promise<void> {
    if (currentDepth > maxDepth) {
      return;
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      const detected = await this.detector.analyzeProjectLanguages(dirPath, claimed);
      const found = detected.filter(
        (project) => project.language !== ProjectLanguage.UNKNOWN
      );
      projects.push(...found);

      const claimedBelow: ReadonlySet<ProjectLanguage> = found.length === 0
        ? claimed
        : new Set([...claimed, ...found.map((project) => project.language)]);

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }

        const subPath = path.join(dirPath, entry.name);
        await this.scanDirectory(subPath, projects, currentDepth + 1, maxDepth, claimedBelow);
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }
  }

  /**
   * Filters projects by language
   */
  filterByLanguage(projects: ProjectInfo[], language: ProjectLanguage): ProjectInfo[] {
    return projects.filter((project) => project.language === language);
  }

  /**
   * Groups projects by language
   */
  groupByLanguage(projects: ProjectInfo[]): Map<ProjectLanguage, ProjectInfo[]> {
    const grouped = new Map<ProjectLanguage, ProjectInfo[]>();

    for (const project of projects) {
      const existing = grouped.get(project.language) || [];
      existing.push(project);
      grouped.set(project.language, existing);
    }

    return grouped;
  }
}
