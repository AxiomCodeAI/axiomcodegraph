import * as fs from 'fs/promises';
import * as path from 'path';

import { LanguageDetector } from './language-detector';

import { JS_SKIP_DIRECTORIES } from '@/constants/javascript-constants';
import { ProjectLanguage } from '@/types/ProjectInfo';
import { isJavaScriptSourceFile } from '@/utils/javascript';

/**
 * Detects JavaScript projects.
 *
 * ## The hard part is not finding JavaScript; it is not claiming TypeScript
 *
 * Almost every TypeScript project contains JavaScript — config files, build
 * scripts, compiled output — and almost every one has a `package.json`. So a
 * detector that matches on `package.json`, or on the mere presence of a `.js`
 * file, claims TypeScript repositories and their facts land under the wrong
 * language.
 *
 * Two rules prevent that:
 *
 * 1. **A `tsconfig.json` disqualifies the directory outright.** It DEFINES a
 *    TypeScript program, which is a stronger claim than any JavaScript manifest
 *    can make, and `TypeScriptDetector` runs first for the same reason.
 * 2. **A `package.json` alone is not enough.** JavaScript source must actually
 *    be present. `package.json` is the manifest of *both* languages and of
 *    plenty of repositories that contain neither.
 *
 * ## `isProject` is SHALLOW and `hasSourceFiles` is deep
 *
 * The same split the Python and TypeScript detectors make, for the reason the
 * Python one records: the scanner stops descending as soon as a directory claims
 * to be a project, so answering yes for any ancestor that merely *contains*
 * JavaScript swallows every sub-project beneath it. A monorepo root with
 * `packages/a` and `packages/b` would become one project and one of them would
 * never be analysed.
 *
 * `node_modules` is excluded by name during the walk. Not a scale optimisation:
 * those files are real JavaScript, and analysing them as PROJECT code stages
 * third-party declarations into `js_*` when they belong in `lib_js_*` — the one
 * distinction the whole provenance split exists to make.
 */
export class JavaScriptDetector implements LanguageDetector {
  readonly language = ProjectLanguage.JAVASCRIPT;
  readonly MAX_DEPTH = 5;

  /**
   * A config that claims the directory for TypeScript.
   *
   * `jsconfig.json` is deliberately NOT here: it is the JavaScript spelling of
   * the same file and is a positive signal, not a disqualifying one.
   */
  private static readonly TYPESCRIPT_MANIFESTS = [
    'tsconfig.json',
    'tsconfig.base.json',
  ];

  /** Files that mark a JavaScript project, given that source is also present. */
  private static readonly MANIFESTS = [
    'package.json',
    'jsconfig.json',
  ];

  private static readonly SKIP = new Set<string>(JS_SKIP_DIRECTORIES);

  async isProject(projectPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(projectPath);
      if (JavaScriptDetector.TYPESCRIPT_MANIFESTS.some((m) => files.includes(m))) {
        return false;
      }
      if (!JavaScriptDetector.MANIFESTS.some((m) => files.includes(m))) {
        // No manifest at all: a loose directory of scripts is still a project,
        // and 15.4% of measured files have no `package.json` anywhere above
        // them. Source is then the only signal there is.
        return this.hasJavaScriptSource(projectPath, 1);
      }
      // A manifest AND source. `package.json` alone matches a TypeScript
      // package, a Python package with an npm wrapper, and an empty repository.
      return this.hasJavaScriptSource(projectPath, 1);
    } catch {
      return false;
    }
  }

  async detectBuildSystem(projectPath: string): Promise<string | undefined> {
    try {
      const files = await fs.readdir(projectPath);
      if (files.includes('pnpm-lock.yaml')) {
        return 'pnpm';
      }
      if (files.includes('yarn.lock')) {
        return 'Yarn';
      }
      if (files.includes('bun.lockb') || files.includes('bun.lock')) {
        return 'Bun';
      }
      if (files.includes('package-lock.json') || files.includes('package.json')) {
        return 'npm';
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** Deep, unlike {@link isProject}: "is there JavaScript under here" is a different question. */
  async hasSourceFiles(projectPath: string): Promise<boolean> {
    return this.hasJavaScriptSource(projectPath, this.MAX_DEPTH);
  }

  private async hasJavaScriptSource(dirPath: string, maxDepth: number): Promise<boolean> {
    if (maxDepth <= 0) {
      return false;
    }
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()
          && isJavaScriptSourceFile(entry.name)) {
          return true;
        }
        if (entry.isDirectory()
          && !entry.name.startsWith('.')
          && !JavaScriptDetector.SKIP.has(entry.name)) {
          if (await this.hasJavaScriptSource(path.join(dirPath, entry.name), maxDepth - 1)) {
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
