import * as fs from 'fs/promises';
import * as path from 'path';

import { LanguageDetector } from './language-detector';

import { FILE_EXTENSIONS } from '@/constants/consts';
import { ProjectLanguage } from '@/types/ProjectInfo';

/**
 * Detects C# projects.
 *
 * A `.csproj` or `.sln` in a directory is an unambiguous manifest, the way
 * `pom.xml` is for Java — and, as with Python, a directory of `.cs` files with
 * no manifest is still a C# project and is what many analysis targets look
 * like (a checkout with the solution one level up, a sample, a generated tree).
 * So source is a sufficient signal rather than a fallback, but SHALLOW: the
 * scanner stops descending as soon as a directory claims to be a project, and
 * answering yes for any ancestor that merely CONTAINS C# swallows every
 * project beneath it. A project root is where the markers are.
 *
 * What this detector does NOT do is read the `.csproj`. Target frameworks,
 * define constants and implicit usings are INPUTS to the analyzer by design:
 * reading a project file would eventually mean evaluating MSBuild, and no .NET
 * runs in this process. The detector answers "is this C#" and "what builds
 * it", nothing more.
 */
export class CSharpDetector implements LanguageDetector {
  readonly language = ProjectLanguage.CSHARP;
  readonly MAX_DEPTH = 5;

  /** Directories that contain C# but are never the project under analysis. */
  private static readonly SKIP = new Set([
    'bin', 'obj', 'node_modules', '.git', '.vs', 'packages', 'TestResults', 'artifacts',
  ]);

  async isProject(projectPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(projectPath);
      if (files.some((f) => CSharpDetector.isManifest(f))) {
        return true;
      }
      // SHALLOW on purpose — see the class comment.
      return await this.hasCSharpSource(projectPath, 1);
    } catch {
      return false;
    }
  }

  async detectBuildSystem(projectPath: string): Promise<string | undefined> {
    try {
      const files = await fs.readdir(projectPath);
      // A solution is the outermost build unit; a project file the next; the
      // SDK's `global.json` pins a toolchain without naming a project.
      if (files.some((f) => f.endsWith('.sln') || f.endsWith('.slnx'))) return 'dotnet solution';
      if (files.some((f) => f.endsWith('.csproj'))) return 'MSBuild';
      if (files.includes('global.json') || files.includes('Directory.Build.props')) return 'dotnet SDK';
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Deep, unlike {@link isProject}: "is there C# under here" is the right
   * question for the reported `hasSourceFiles` flag and the wrong one for
   * deciding where a project begins.
   */
  async hasSourceFiles(projectPath: string): Promise<boolean> {
    return this.hasCSharpSource(projectPath, this.MAX_DEPTH);
  }

  private static isManifest(fileName: string): boolean {
    return (
      fileName.endsWith('.csproj') ||
      fileName.endsWith('.sln') ||
      fileName.endsWith('.slnx') ||
      fileName === 'Directory.Build.props' ||
      fileName === 'global.json'
    );
  }

  private async hasCSharpSource(dirPath: string, maxDepth: number): Promise<boolean> {
    if (maxDepth <= 0) return false;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(FILE_EXTENSIONS.CSHARP)) {
          return true;
        }
        if (entry.isDirectory() && !entry.name.startsWith('.') && !CSharpDetector.SKIP.has(entry.name)) {
          if (await this.hasCSharpSource(path.join(dirPath, entry.name), maxDepth - 1)) {
            return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  }
}
