import * as fs from 'fs/promises';
import * as path from 'path';

import { CSharpDetector } from '@/language-detectors/csharp-detector';
import { JavaDetector } from '@/language-detectors/java-detector';
import { JavaScriptDetector } from '@/language-detectors/javascript-detector';
import { LanguageDetector } from '@/language-detectors/language-detector';
import { PythonDetector } from '@/language-detectors/python-detector';
import { TypeScriptDetector } from '@/language-detectors/typescript-detector';
import { ProjectLanguage, ProjectInfo } from '@/types/ProjectInfo';

/**
 * Detects and analyzes projects in a directory to determine their programming language
 * and build system. Uses a plugin-based architecture with language-specific detectors.
 */
export class ProjectDetector {
  private detectors: LanguageDetector[] = [];

  constructor() {
    // Order matters: detectors are tried in turn and the first match wins. Java
    // first because its manifests are unambiguous, Python second because a bare
    // directory of .py files is a valid Python project and would otherwise be a
    // greedy match on mixed repositories.
    this.registerDetector(new JavaDetector());
    // C# next, for the reason Java is first: `.csproj` and `.sln` are
    // unambiguous manifests, and a repository holding both C# and TypeScript
    // (an ASP.NET app with a client folder) should be claimed by the project
    // file at its root rather than by the `tsconfig.json` under it.
    this.registerDetector(new CSharpDetector());
    // TypeScript before Python: `tsconfig.json` DEFINES a program, so it is a
    // stronger claim than any Python manifest, and a repository holding both
    // should not have its TypeScript swallowed by a bare directory of .py files
    // matching first.
    this.registerDetector(new TypeScriptDetector());
    // JavaScript after TypeScript and before Python. After TypeScript because
    // almost every TypeScript repository contains JavaScript — config files,
    // build scripts, compiled output — and `package.json` is the manifest of
    // both, so a JavaScript-first order claims TypeScript projects and files
    // their facts under the wrong language. Before Python for the same reason
    // TypeScript is: a bare directory of `.py` files is a greedy match.
    this.registerDetector(new JavaScriptDetector());
    this.registerDetector(new PythonDetector());
  }

  /**
   * Registers a language detector
   * @param detector Language-specific detector implementation
   */
  registerDetector(detector: LanguageDetector): void {
    this.detectors.push(detector);
  }

  /**
   * Analyzes a directory and returns one {@link ProjectInfo} per language found
   * there.
   *
   * A directory can be several projects at once. A Java service with its deploy
   * scripts beside it is Java AND Python, and returning only the first match
   * meant the scripts were never parsed. Every detector that claims the
   * directory gets an entry, so the caller can run every matching analyzer over
   * it rather than picking a winner.
   *
   * `skip` names languages an ancestor directory has already claimed. Those
   * detectors are not consulted at all — not merely filtered afterwards. That is
   * what keeps the scan affordable now that it no longer stops at the first
   * match: `JavaDetector.isProject` walks five levels deep on every directory it
   * is asked about, and asking it about every directory in a Java monorepo would
   * cost far more than the answer is worth when an ancestor has already claimed
   * Java and will analyse this directory anyway.
   *
   * @returns One entry per matching language, in detector registration order.
   *   Empty when nothing matches — an UNKNOWN placeholder would be indistinguishable
   *   from a real project to a caller that filters by language.
   */
  async analyzeProjectLanguages(
    projectPath: string,
    skip: ReadonlySet<ProjectLanguage> = new Set()
  ): Promise<ProjectInfo[]> {
    try {
      const stats = await fs.stat(projectPath);
      if (!stats.isDirectory()) {
        return [];
      }

      const projectName = path.basename(projectPath);
      const found: ProjectInfo[] = [];

      for (const detector of this.detectors) {
        if (skip.has(detector.language)) {
          continue;
        }
        if (!(await detector.isProject(projectPath))) {
          continue;
        }
        found.push({
          name: projectName,
          path: projectPath,
          language: detector.language,
          buildSystem: await detector.detectBuildSystem(projectPath),
          hasSourceFiles: await detector.hasSourceFiles(projectPath),
        });
      }

      return found;
    } catch (error) {
      return [];
    }
  }

  /**
   * Analyzes a directory and returns project information for its primary
   * language — the first detector that claims it.
   *
   * Prefer {@link analyzeProjectLanguages}: this collapses a polyglot directory
   * to one language and is kept for callers that genuinely want a single label.
   */
  async analyzeProject(projectPath: string): Promise<ProjectInfo | null> {
    try {
      const stats = await fs.stat(projectPath);
      if (!stats.isDirectory()) {
        return null;
      }

      const [primary] = await this.analyzeProjectLanguages(projectPath);
      return primary ?? {
        name: path.basename(projectPath),
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
