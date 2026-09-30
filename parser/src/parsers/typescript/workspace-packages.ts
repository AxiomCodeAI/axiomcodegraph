import * as fs from 'fs';
import * as path from 'path';

import { PackageJsonFacts, PackageJsonResolver } from '@/parsers/javascript/package-json-resolver';
import { sourceModuleForSubpath } from '@/parsers/typescript/ts-package-entry-extractor';

/**
 * The packages a repository declares itself, by name: every named `package.json`
 * under the walked tree. Shared by the TypeScript and JavaScript front ends.
 *
 * ## Why import resolution needs this
 *
 * In a monorepo, app code imports a sibling package by its NAME (`'@scope/lib'`,
 * `'@scope/lib/sub'`), and that package's `main` / `types` / `exports` name build
 * output (`./dist/index.d.ts`) that is not in the source tree. `ts.resolveModuleName`
 * then finds nothing (no `node_modules`), or a `dist` file no program walks (a
 * `node_modules` symlink into the repository after a build). Either way the import
 * bound to no module, and every function, class and const used across the package
 * boundary was matched by name only.
 *
 * The package is in the repository, though, and its entry names the source it is
 * built from by the same convention the entry rows already use
 * (`sourceModuleForSubpath`). So a bare specifier whose package is one of these binds
 * to that walked source module.
 *
 * ## What it does not claim
 *
 * A name two `package.json` files share is ambiguous and binds nothing. A specifier
 * tsc resolved into `node_modules` is a real installed package and is never asked
 * here, so a dependency that happens to share a name with a fixture stays external.
 */
export class WorkspacePackages {
  private constructor(private readonly byName: ReadonlyMap<string, PackageJsonFacts>) {}

  /** Every named package at or under `rootDir`, skipping `skipDirectories` and dot directories. */
  static discover(rootDir: string, skipDirectories: ReadonlySet<string>): WorkspacePackages {
    const reader = new PackageJsonResolver();
    const byName = new Map<string, PackageJsonFacts | null>();
    const visit = (directory: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isFile() && entry.name === 'package.json') {
          const facts = reader.packageAt(directory);
          if (facts !== undefined && facts.name !== '') {
            byName.set(facts.name, byName.has(facts.name) ? null : facts);
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.')
          && !skipDirectories.has(entry.name)) {
          visit(path.join(directory, entry.name));
        }
      }
    };
    visit(rootDir);
    const unique = new Map<string, PackageJsonFacts>();
    for (const [name, facts] of byName) {
      if (facts !== null) {
        unique.set(name, facts);
      }
    }
    return new WorkspacePackages(unique);
  }

  get size(): number {
    return this.byName.size;
  }

  /**
   * The walked source module a bare specifier names, or `undefined` when its package
   * is not one of these or its entry maps to no walked source.
   *
   * @param moduleHashOf  the module hash of an absolute, normalised source path, or
   *                      `undefined` when no program walks it
   */
  resolve(
    specifier: string,
    moduleHashOf: (absolutePath: string) => string | undefined,
    extensions?: readonly string[]
  ): { readonly absolutePath: string; readonly moduleHash: string; readonly packageName: string } | undefined {
    const name = bareSpecifierPackageName(specifier);
    const facts = name === '' ? undefined : this.byName.get(name);
    if (facts === undefined) {
      return undefined;
    }
    const rest = specifier.slice(name.length);
    const subpath = rest === '' ? '.' : `.${rest}`;
    const found = sourceModuleForSubpath(facts, subpath,
      (absolutePath) => {
        const moduleHash = moduleHashOf(absolutePath);
        return moduleHash === undefined ? undefined : { absolutePath, moduleHash };
      }, extensions);
    return found === undefined ? undefined : { ...found, packageName: name };
  }
}

/** `@scope/name` of `@scope/name/deep`, `name` of `name/deep`; `''` for anything not a bare package specifier. */
function bareSpecifierPackageName(specifier: string): string {
  if (specifier === '' || specifier.startsWith('.') || specifier.startsWith('/')
    || specifier.includes('*') || specifier.includes(':')) {
    return '';
  }
  const segments = specifier.split('/');
  if (specifier.startsWith('@')) {
    return segments.length >= 2 && segments[1] !== '' ? `${segments[0]}/${segments[1]}` : '';
  }
  return segments[0] ?? '';
}
