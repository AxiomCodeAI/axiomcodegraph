import * as fs from 'fs/promises';
import * as path from 'path';

import { LanguageDetector } from './language-detector';

import { FILE_EXTENSIONS } from '@/constants/consts';
import { ProjectLanguage } from '@/types/ProjectInfo';

export class JavaDetector implements LanguageDetector {
  readonly language = ProjectLanguage.JAVA;
  readonly MAX_DEPTH = 5;

  async isProject(projectPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(projectPath);

      const hasPom = files.includes('pom.xml');
      const hasGradle = files.includes('build.gradle') || files.includes('build.gradle.kts');
      const hasMaven = files.includes('mvnw') || files.includes('mvnw.cmd');

      if (hasPom || hasGradle || hasMaven) {
        return true;
      }

      const hasSrcMain = files.includes('src');
      if (hasSrcMain) {
        const srcPath = path.join(projectPath, 'src');
        const srcStats = await fs.stat(srcPath);
        if (srcStats.isDirectory()) {
          const srcContents = await fs.readdir(srcPath);
          if (srcContents.includes('main')) {
            const mainPath = path.join(srcPath, 'main');
            const mainContents = await fs.readdir(mainPath);
            if (mainContents.includes('java')) {
              return true;
            }
          }
        }
      }

      return await this.hasSourceFiles(projectPath);
    } catch (error) {
      return false;
    }
  }

  async detectBuildSystem(projectPath: string): Promise<string | undefined> {
    try {
      const files = await fs.readdir(projectPath);

      if (files.includes('pom.xml')) {
        return 'Maven';
      }
      if (files.includes('build.gradle') || files.includes('build.gradle.kts')) {
        return 'Gradle';
      }
      return undefined;
    } catch (error) {
      return undefined;
    }
  }

  async hasSourceFiles(projectPath: string): Promise<boolean> {
    return this.hasFilesWithExtension(projectPath, FILE_EXTENSIONS.JAVA, this.MAX_DEPTH);
  }

  private async hasFilesWithExtension(
    dirPath: string,
    extension: string,
    maxDepth: number
  ): Promise<boolean> {
    if (maxDepth <= 0) return false;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(extension)) {
          return true;
        }
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const subPath = path.join(dirPath, entry.name);
          const found = await this.hasFilesWithExtension(subPath, extension, maxDepth - 1);
          if (found) return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }
}
