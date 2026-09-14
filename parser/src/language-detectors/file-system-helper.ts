import * as fs from 'fs/promises';
import * as path from 'path';

export class FileSystemHelper {
  /**
   * Checks if directory contains files with specific extension
   */
  static async hasFilesWithExtension(
    dirPath: string,
    extension: string,
    maxDepth: number = 2
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
