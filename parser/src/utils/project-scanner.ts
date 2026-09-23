import * as fs from 'fs/promises';
import * as path from 'path';

import { EXCLUDED_DIRS, isJavaTestDir } from '@/constants/consts';
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
   * @param maxDepth How deep to look for a project root. Unbounded by default:
   *   a shallow detector only claims a directory that holds source itself, so a
   *   file under directories that hold none is reachable only by descending to
   *   it, and a limit there loses the file without a trace (#1176). An ancestor's
   *   claim still stops the same language from being recorded twice below it.
   *   The name exclusions (`node_modules`, build output, dot-directories) are
   *   what bounds the walk.
   * @param excludeTests Do not descend into a test directory (`test`, `tests`,
   *   `__tests__`, `test-*`, `integration-tests`, `e2e`), so it never becomes a
   *   project root of its own. Each analyzer excludes those names while walking
   *   BELOW the root it is given; a `test/` that discovery registered as its own root
   *   was walked from inside, where the exclusion could never see its name, and the
   *   flag excluded nothing for JavaScript, TypeScript and Python (#613). Java was
   *   unaffected only because its roots are build-descriptor shaped.
   */
  async scanForProjects(rootPath: string, maxDepth: number = Infinity, excludeTests: boolean = false): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = [];
    await this.scanDirectory(rootPath, projects, 0, maxDepth, new Set(), excludeTests);
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
    claimed: ReadonlySet<ProjectLanguage>,
    excludeTests: boolean
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
        if (excludeTests && isJavaTestDir(entry.name)) {
          continue;
        }

        const subPath = path.join(dirPath, entry.name);
        await this.scanDirectory(subPath, projects, currentDepth + 1, maxDepth, claimedBelow, excludeTests);
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
