import * as fs from 'fs/promises';
import * as path from 'path';

import { JavaDetector } from '@/language-detectors/java-detector';
import { LanguageDetector } from '@/language-detectors/language-detector';
import { ProjectLanguage, ProjectInfo } from '@/types/ProjectInfo';

/**
 * Detects and analyzes projects in a directory to determine their programming language
 * and build system. Uses a plugin-based architecture with language-specific detectors.
 */
export class ProjectDetector {
  private detectors: LanguageDetector[] = [];

  constructor() {
    this.registerDetector(new JavaDetector());
  }

  /**
   * Registers a language detector
   * @param detector Language-specific detector implementation
   */
  registerDetector(detector: LanguageDetector): void {
    this.detectors.push(detector);
  }

  /**
   * Analyzes a directory and returns project information
   * Iterates through registered language detectors to identify the project type
   */
  async analyzeProject(projectPath: string): Promise<ProjectInfo | null> {
    try {
      const stats = await fs.stat(projectPath);
      if (!stats.isDirectory()) {
        return null;
      }

      const projectName = path.basename(projectPath);

      for (const detector of this.detectors) {
        const isProject = await detector.isProject(projectPath);
        if (isProject) {
          const buildSystem = await detector.detectBuildSystem(projectPath);
          const hasSourceFiles = await detector.hasSourceFiles(projectPath);

          return {
            name: projectName,
            path: projectPath,
            language: detector.language,
            buildSystem,
            hasSourceFiles,
          };
        }
      }

      return {
        name: projectName,
        path: projectPath,
        language: ProjectLanguage.UNKNOWN,
        hasSourceFiles: false,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Gets all registered language detectors
   */
  getDetectors(): LanguageDetector[] {
    return [...this.detectors];
  }

  /**
   * Gets a specific language detector by language
   */
  getDetector(language: ProjectLanguage): LanguageDetector | undefined {
    return this.detectors.find((d) => d.language === language);
  }
}
