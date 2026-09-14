import * as fs from 'fs/promises';
import * as path from 'path';

import { LanguageDetector } from './language-detector';

import { TS_SKIP_DIRECTORIES, TS_SOURCE_EXTENSIONS } from '@/constants/typescript-constants';
import { ProjectLanguage } from '@/types/ProjectInfo';

/**
 * Detects TypeScript projects.
 *
 * `tsconfig.json` is the strong signal, and unlike Python's manifests it is not
 * merely conventional: it DEFINES the program, so a directory that has one is a
 * project boundary by the compiler's own reckoning. That matters more here than
 * elsewhere, because a program is also the unit of merge scope — two programs
 * have two global scopes, and analysing them as one merges symbols tsc keeps
 * apart.
 *
 * `package.json` alone is not enough: a JavaScript package with no TypeScript in
 * it would match, and analysing it would produce an empty fact base attributed
 * to a language it does not use. Source files are the fallback signal, exactly
 * as they are for Python.
 *
 * `node_modules` is excluded by name during the walk. It is not a scale
 * optimisation — the files in there are real TypeScript, and analysing them as
 * PROJECT code would stage tens of thousands of third-party declarations into
 * `ts_*` when they belong in `lib_ts_*`, which is the one distinction the whole
 * provenance split exists to make.
 */
export class TypeScriptDetector implements LanguageDetector {
  readonly language = ProjectLanguage.TYPESCRIPT;
  readonly MAX_DEPTH = 5;

  /** Files that mark a TypeScript project before any source is found. */
  private static readonly MANIFESTS = [
    'tsconfig.json',
    'tsconfig.base.json',
    'jsconfig.json',
  ];

  private static readonly SKIP = new Set<string>(TS_SKIP_DIRECTORIES);

  async isProject(projectPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(projectPath);
      if (TypeScriptDetector.MANIFESTS.some((m) => files.includes(m))) {
        return true;
      }
      // SHALLOW on purpose, for the reason the Python detector records: the
      // scanner stops descending as soon as a directory claims to be a project,
      // so answering yes for any ancestor that merely CONTAINS TypeScript
      // swallows every sub-project beneath it. A monorepo root with svc-api/
      // and svc-web/ would become one project and one of them would never be
      // analysed.
      return await this.hasTypeScriptSource(projectPath, 1);
    } catch {
      return false;
    }
  }

  async detectBuildSystem(projectPath: string): Promise<string | undefined> {
    try {
      const files = await fs.readdir(projectPath);
      if (files.includes('pnpm-lock.yaml')) return 'pnpm';
      if (files.includes('yarn.lock')) return 'Yarn';
      if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'Bun';
      if (files.includes('package-lock.json')) return 'npm';
      if (files.includes('package.json')) return 'npm';
      if (files.includes('tsconfig.json')) return 'tsc';
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** Deep, unlike {@link isProject}: "is there TypeScript under here" is a different question. */
  async hasSourceFiles(projectPath: string): Promise<boolean> {
    return this.hasTypeScriptSource(projectPath, this.MAX_DEPTH);
  }

  private async hasTypeScriptSource(dirPath: string, maxDepth: number): Promise<boolean> {
    if (maxDepth <= 0) return false;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()
          && TS_SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
          return true;
        }
        if (entry.isDirectory()
          && !entry.name.startsWith('.')
          && !TypeScriptDetector.SKIP.has(entry.name)) {
          if (await this.hasTypeScriptSource(path.join(dirPath, entry.name), maxDepth - 1)) {
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
