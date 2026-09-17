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
 * The rule that prevents that: **a manifest alone is not enough.** JavaScript
 * source must actually be present in the directory itself. `package.json` is
 * the manifest of *both* languages and of plenty of repositories that contain
 * neither.
 *
 * A `tsconfig.json` used to disqualify the directory outright, on the ground
 * that it DEFINES a TypeScript program. Since a directory can be several
 * projects at once (#566), that exclusion cost real code: a JavaScript
 * repository typechecked through a root `tsconfig.json` with `allowJs` (the
 * standard JSDoc setup) lost every loose `.js` file of that directory, because
 * the TypeScript analyzer emits nothing for `.js` program members and no
 * descendant JavaScript project covers the directory's own files. Those files
 * were exactly the package entry points, and they left no skip row (#595). The
 * TypeScript claim still stands beside this one; the JavaScript claim only adds
 * the `.js` files, which the TypeScript analyzer never emits, so nothing is
 * extracted twice.
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

  /** Files that mark a JavaScript project, given that source is also present. */
  private static readonly MANIFESTS = [
    'package.json',
    'jsconfig.json',
  ];

  private static readonly SKIP = new Set<string>(JS_SKIP_DIRECTORIES);

  async isProject(projectPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(projectPath);
      if (!JavaScriptDetector.MANIFESTS.some((m) => files.includes(m))) {
        // No manifest at all: a loose directory of scripts is still a project,
        // and 15.4% of measured files have no `package.json` anywhere above
        // them. Source is then the only signal there is.
        return this.hasJavaScriptSource(projectPath, 1);
      }
      // A manifest AND source. `package.json` alone matches a TypeScript
      // package, a Python package with an npm wrapper, and an empty repository.
      if (await this.hasJavaScriptSource(projectPath, 1)) {
        return true;
      }
      // A package that SHIPS FROM A BUILD DIRECTORY has no JavaScript directly in
      // its package directory: `package.json`, `dist/`, `src/`, `examples/`. Without
      // this, the scanner descends past it and registers `src/`, `examples/` and
      // `tests/` as projects of their own, so the entry points under `dist/` are never
      // staged and every import of the package reads as `not_staged` although it was
      // passed with `--library` (#797). The manifest naming a file that exists under a
      // build directory is the package saying where its code is, which is a stronger
      // signal than a loose `.js` at the top level (#620).
      return this.entriesPointIntoBuildDirectory(projectPath, files);
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

  /**
   * Does `package.json` name a JavaScript file that exists under a directory the walk
   * would otherwise skip (`dist`, `build`, `lib`, `out`)? That is a package shipping from
   * a build directory, and the package directory is its root (#797).
   *
   * Only entries that RESOLVE are accepted: a manifest may name a file that was never
   * published, and answering yes for a directory with nothing to parse would swallow the
   * sub-projects the scanner would otherwise find.
   */
  private async entriesPointIntoBuildDirectory(
    projectPath: string, files: readonly string[],
  ): Promise<boolean> {
    if (!files.includes('package.json')) {
      return false;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf8'));
    } catch {
      return false;
    }
    for (const entry of JavaScriptDetector.entryPaths(manifest)) {
      const rel = entry.replace(/^\.\//, '');
      const segment = rel.split('/')[0];
      if (segment === undefined || segment === '' || !JavaScriptDetector.SKIP.has(segment)) {
        continue;
      }
      if (!isJavaScriptSourceFile(rel)) {
        continue;
      }
      try {
        const stat = await fs.stat(path.join(projectPath, rel));
        if (stat.isFile()) {
          return true;
        }
      } catch {
        // named but not published: keep looking
      }
    }
    return false;
  }

  /** `main`, `module`, `browser`, `bin` and every string leaf of `exports`. */
  private static* entryPaths(manifest: unknown): Generator<string> {
    if (typeof manifest !== 'object' || manifest === null) {
      return;
    }
    const m = manifest as Record<string, unknown>;
    for (const key of ['main', 'module', 'browser', 'unpkg', 'jsdelivr']) {
      if (typeof m[key] === 'string') {
        yield m[key] as string;
      }
    }
    if (typeof m['bin'] === 'string') {
      yield m['bin'] as string;
    }
    yield* JavaScriptDetector.stringLeaves(m['bin']);
    yield* JavaScriptDetector.stringLeaves(m['exports']);
  }

  private static* stringLeaves(node: unknown): Generator<string> {
    if (typeof node === 'string') {
      yield node;
      return;
    }
    if (typeof node !== 'object' || node === null) {
      return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      yield* JavaScriptDetector.stringLeaves(value);
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
