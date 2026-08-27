import * as fs from 'fs/promises';
import * as path from 'path';

import { LanguageDetector } from './language-detector';

import { FILE_EXTENSIONS } from '@/constants/consts';
import { ProjectLanguage } from '@/types/ProjectInfo';

/**
 * Detects Python projects.
 *
 * Python has no single required manifest the way Maven has `pom.xml`, and the
 * common ones are all optional: a package can ship with `pyproject.toml`,
 * `setup.py`, `setup.cfg`, a requirements file, a Pipfile, or none of them. A
 * directory of `.py` files with no manifest at all is still a Python project and
 * is what most analysis targets actually look like, so source files are a
 * sufficient signal rather than a fallback.
 *
 * Virtualenvs are excluded by name during the walk. A `site-packages` tree is
 * thousands of third-party files that would be analysed as if they were the
 * project, and `.venv` sitting in the root is the normal case, not the exception.
 */
export class PythonDetector implements LanguageDetector {
  readonly language = ProjectLanguage.PYTHON;
  readonly MAX_DEPTH = 5;

  /** Manifests that mark a Python project even before any source is found. */
  private static readonly MANIFESTS = [
    'pyproject.toml',
    'setup.py',
    'setup.cfg',
    'requirements.txt',
    'requirements-dev.txt',
    'Pipfile',
    'poetry.lock',
    'tox.ini',
    'environment.yml',
  ];

  /** Directories that contain Python but are never the project under analysis. */
  private static readonly SKIP = new Set([
    'site-packages', 'dist-packages', 'node_modules', '__pycache__',
    'venv', '.venv', 'env', '.env', '.tox', '.nox', 'build', 'dist',
    '.mypy_cache', '.pytest_cache', '.ruff_cache', '.eggs',
  ]);

  async isProject(projectPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(projectPath);
      if (PythonDetector.MANIFESTS.some((m) => files.includes(m))) {
        return true;
      }
      // A package directory is a strong signal even with no manifest above it.
      if (files.includes('__init__.py')) {
        return true;
      }
      // SHALLOW on purpose. The scanner stops descending as soon as a directory
      // claims to be a project, so answering yes for any ancestor that merely
      // CONTAINS Python swallows every sub-project beneath it. A monorepo root
      // with svc-java/ and svc-python/ was detected as one Python project and
      // the Java service was never analysed at all.
      //
      // A project root is where the markers are, not any directory above them.
      return await this.hasPythonSource(projectPath, 1);
    } catch {
      return false;
    }
  }

  async detectBuildSystem(projectPath: string): Promise<string | undefined> {
    try {
      const files = await fs.readdir(projectPath);
      if (files.includes('poetry.lock')) return 'Poetry';
      if (files.includes('Pipfile')) return 'Pipenv';
      if (files.includes('pyproject.toml')) return 'PEP 517';
      if (files.includes('setup.py') || files.includes('setup.cfg')) return 'setuptools';
      if (files.includes('requirements.txt')) return 'pip';
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Deep, unlike {@link isProject}. This answers "is there Python under here",
   * which is the right question for the reported `hasSourceFiles` flag and the
   * wrong one for deciding where a project begins.
   */
  async hasSourceFiles(projectPath: string): Promise<boolean> {
    return this.hasPythonSource(projectPath, this.MAX_DEPTH);
  }

  private async hasPythonSource(dirPath: string, maxDepth: number): Promise<boolean> {
    if (maxDepth <= 0) return false;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()
          && (entry.name.endsWith(FILE_EXTENSIONS.PYTHON)
            || entry.name.endsWith(FILE_EXTENSIONS.PYTHON_STUB))) {
          return true;
        }
        if (entry.isDirectory()
          && !entry.name.startsWith('.')
          && !PythonDetector.SKIP.has(entry.name)) {
          if (await this.hasPythonSource(path.join(dirPath, entry.name), maxDepth - 1)) {
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
