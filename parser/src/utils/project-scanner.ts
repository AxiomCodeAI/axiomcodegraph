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
    await this.scanDirectory(rootPath, projects, 0, maxDepth);
    return projects;
  }

  /**
   * Recursively scans directories for projects
   */
  private async scanDirectory(
    dirPath: string,
    projects: ProjectInfo[],
    currentDepth: number,
    maxDepth: number
  ): Promise<void> {
    if (currentDepth > maxDepth) {
      return;
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      const projectInfo = await this.detector.analyzeProject(dirPath);
      if (projectInfo && projectInfo.language !== ProjectLanguage.UNKNOWN) {
        projects.push(projectInfo);
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }

        const subPath = path.join(dirPath, entry.name);
        await this.scanDirectory(subPath, projects, currentDepth + 1, maxDepth);
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
