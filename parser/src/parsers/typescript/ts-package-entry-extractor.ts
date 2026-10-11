import * as path from 'path';

import { TsPackageEntryRegistry } from '@/analysis-types/typescript/TsPackageEntryRegistry';
import { JsPackageEntrySource } from '@/enums/javascript/packages';
import { TsPackageEntryOutcome, TsPackageEntrySource } from '@/enums/typescript/packages';
import { packageEntriesOf, PackageEntry } from '@/parsers/javascript/package-entry-extractor';
import { PackageJsonFacts } from '@/parsers/javascript/package-json-resolver';

/**
 * What a TypeScript package PUBLISHES, as `ts_package_entry` rows (#847).
 *
 * ## Why the TypeScript front end reads package.json at all
 *
 * The engine's only structural root for a library was "a module nothing imports".
 * A library's `index.ts` is imported by its own tests, so it was not a root, and
 * the package's whole public API -- called by a consumer who is not in the
 * repository -- read as unreachable. Unreachable reads as safe to delete, which is
 * the dangerous direction. `package.json` names the published modules; this is the
 * fact the engine was missing.
 *
 * ## The walk is JavaScript's; the resolution is not
 *
 * Which entries a `package.json` declares is Node's rule and is the same for both
 * front ends, so `packageEntriesOf` is reused as-is. What differs is the target:
 * a TypeScript package's `main` and `exports` name BUILD OUTPUT (`dist/cjs/index.js`,
 * `esm/index.mjs`, `dist/index.d.ts`) that this parse never walks. So each target is
 * mapped back to the walked source it compiles from, by one fixed convention:
 *
 *   1. the target itself, when it is a walked file (`"source": "src/index.ts"`);
 *   2. the target with its output extension swapped for a source one, in place;
 *   3. the same after dropping leading build-output directories (`dist/`, `esm/`,
 *      `cjs/`, ...), at the package root and under `src/`;
 *   and at each of 2 and 3, a directory's `index`.
 *
 * The first walked file wins. Nothing is guessed past that list: a target none of
 * them answers is `NO_SOURCE_MODULE` and carries no module hash, so it roots nothing.
 * A subpath pattern is expanded the same way, one row per walked module it publishes.
 */

/** Directory names a build writes into, as the first segments of a published path. */
const BUILD_OUTPUT_SEGMENTS: ReadonlySet<string> = new Set([
  'dist', 'build', 'out', 'lib', 'esm', 'cjs', 'es', 'umd', 'mjs', 'types', 'typings', 'dts',
]);

/** Extensions a compiled or declaration target carries, longest first. */
const OUTPUT_EXTENSION = /(\.d\.(m|c)?ts|\.(m|c)?(j|t)sx?)$/;

/** Source extensions, in the order a file is looked for. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;

/** Package-relative, extension-less paths to try for one target, in order. */
function sourceStemsFor(targetPath: string): string[] {
  const base = targetPath.replace(OUTPUT_EXTENSION, '');
  const stems = [base];
  const segments = base.split('/');
  let first = 0;
  while (first < segments.length - 1 && BUILD_OUTPUT_SEGMENTS.has(segments[first]!)) {
    first += 1;
  }
  const rest = segments.slice(first).join('/');
  stems.push(rest);
  if (!rest.startsWith('src/')) {
    stems.push(`src/${rest}`);
  }
  return [...new Set(stems)];
}

/**
 * The walked source module a target compiles from, or `undefined`.
 *
 * @returns `[moduleHash, exact]` — `exact` when the target itself is the walked file
 */
function sourceModuleFor<T>(
  packageDir: string,
  targetPath: string,
  moduleHashOf: (absolutePath: string) => T | undefined,
  extensions: readonly string[] = SOURCE_EXTENSIONS
): [T, boolean] | undefined {
  const exact = moduleHashOf(path.normalize(path.resolve(packageDir, targetPath)));
  if (exact !== undefined) {
    return [exact, true];
  }
  for (const stem of sourceStemsFor(targetPath)) {
    for (const candidate of [stem, `${stem}/index`]) {
      for (const extension of extensions) {
        const hash = moduleHashOf(path.normalize(path.resolve(packageDir, candidate + extension)));
        if (hash !== undefined) {
          return [hash, false];
        }
      }
    }
  }
  return undefined;
}

/**
 * The walked source modules a subpath PATTERN (`"./*": "./esm/*.mjs"`) publishes, as
 * `[subpath, target, moduleHash]`, or `[]`.
 *
 * Node substitutes the `*` into both sides, so every walked source file whose path
 * fits the target's source stem is one published module. Narrower than Node on
 * purpose: the `*` stands for ONE path segment here, where Node lets it span `/`,
 * so a pattern publishes a directory's own modules and not everything beneath it.
 * The first stem that matches anything wins, in the same order as a plain target.
 */
function sourceModulesForPattern(
  packageDir: string,
  subpath: string,
  targetPath: string,
  walkedFiles: readonly string[]
): Array<[string, string, string]> {
  if (subpath.split('*').length !== 2 || targetPath.split('*').length !== 2) {
    return [];
  }
  const relative = walkedFiles
    .map((file) => [path.relative(packageDir, file).split(path.sep).join('/'), file] as const)
    .filter(([rel]) => !rel.startsWith('..') && !path.isAbsolute(rel));
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `src/` before the bare package root: a pattern at the root (`"./*": "./*.js"`)
  // would otherwise match the root's own config files (`vitest.config.ts`) first.
  const stems = sourceStemsFor(targetPath);
  const ordered = [...stems.filter((s) => s.startsWith('src/')), ...stems.filter((s) => !s.startsWith('src/'))];
  for (const stem of ordered) {
    const [before, after] = stem.split('*') as [string, string];
    const shape = new RegExp(
      `^${escape(before)}([^/]+)${escape(after)}(${SOURCE_EXTENSIONS.map(escape).join('|')})$`);
    const found: Array<[string, string, string]> = [];
    for (const [rel, file] of relative) {
      const match = shape.exec(rel);
      if (match === null || match[1]!.endsWith('.d')) {
        continue;
      }
      found.push([subpath.replace('*', match[1]!), targetPath.replace('*', match[1]!), file]);
    }
    if (found.length > 0) {
      return found.sort((a, b) => a[0].localeCompare(b[0]));
    }
  }
  return [];
}

/**
 * The walked source module a consumer's import of `subpath` (`"."`, `"./sub"`) binds
 * to, by the same convention as the entry rows: the package's own entry for that
 * subpath, mapped from build output back to source.
 *
 * `source` and `types` count for `"."` as they do for the rows. A subpath pattern
 * substitutes its `*` into the target, as Node does. A package with no `exports`
 * publishes every file, so a deep subpath (`"./sub"`, `"./dist/sub"`) is its own
 * target. With `exports` present, a subpath it does not list is blocked for Node and
 * binds to nothing here either. `extensions` are the source extensions looked for, in
 * order: TypeScript's by default, JavaScript's for a JavaScript workspace.
 */
export function sourceModuleForSubpath<T>(
  facts: PackageJsonFacts,
  subpath: string,
  moduleHashOf: (absolutePath: string) => T | undefined,
  extensions: readonly string[] = SOURCE_EXTENSIONS
): T | undefined {
  const packageDir = path.dirname(facts.path);
  const strip = (target: string): string => target.replace(/^\.\//, '');
  const entries = packageEntriesOf(facts);
  const targets: string[] = [];
  if (subpath === '.' && facts.source !== undefined && facts.source !== '') {
    targets.push(strip(facts.source));
  }
  for (const entry of entries) {
    if (entry.subpath === subpath && entry.targetPath !== '' && !entry.targetPath.includes('*')) {
      targets.push(entry.targetPath);
    }
  }
  for (const entry of entries) {
    const [before, after, ...more] = entry.subpath.split('*');
    if (after === undefined || more.length > 0 || entry.targetPath === ''
      || !subpath.startsWith(before!) || !subpath.endsWith(after)
      || subpath.length < before!.length + after.length) {
      continue;
    }
    const match = subpath.slice(before!.length, subpath.length - after.length);
    targets.push(entry.targetPath.split('*').join(match));
  }
  if (subpath === '.' && facts.types !== undefined && facts.types !== '') {
    targets.push(strip(facts.types));
  }
  if (subpath !== '.' && facts.exports === undefined) {
    targets.push(strip(subpath));
  }
  for (const target of targets) {
    const found = sourceModuleFor(packageDir, target, moduleHashOf, extensions);
    if (found !== undefined) {
      return found[0];
    }
  }
  return undefined;
}

const SOURCE_OF: Record<JsPackageEntrySource, TsPackageEntrySource> = {
  [JsPackageEntrySource.MAIN]: TsPackageEntrySource.MAIN,
  [JsPackageEntrySource.MODULE]: TsPackageEntrySource.MODULE,
  [JsPackageEntrySource.EXPORTS]: TsPackageEntrySource.EXPORTS,
  [JsPackageEntrySource.DEFAULT_INDEX]: TsPackageEntrySource.DEFAULT_INDEX,
};

/**
 * The `ts_package_entry` rows for one `package.json`, resolved against the modules
 * this program walked.
 *
 * @param moduleHashOf  the module hash for an absolute, normalised file path, or
 *                      `undefined` when this program did not walk the file
 */
export function extractTsPackageEntries(options: {
  facts: PackageJsonFacts;
  /** The `package.json` path, relative to the path anchor. */
  packageJsonPath: string;
  moduleHashOf: (absolutePath: string) => string | undefined;
  /** Every file this program walked, absolute and normalised, for subpath patterns. */
  walkedFiles: readonly string[];
  serviceVersionLinkHash: string;
}): TsPackageEntryRegistry[] {
  const { facts } = options;
  const packageDir = path.dirname(facts.path);
  const strip = (target: string): string => target.replace(/^\.\//, '');
  const entries: Array<Omit<PackageEntry, 'source'> & { source: TsPackageEntrySource }> =
    packageEntriesOf(facts).map((entry) => ({ ...entry, source: SOURCE_OF[entry.source] }));
  if (facts.types !== undefined && facts.types !== '') {
    entries.push({ subpath: '.', condition: '', source: TsPackageEntrySource.TYPES, targetPath: strip(facts.types) });
  }
  if (facts.source !== undefined && facts.source !== '') {
    entries.push({ subpath: '.', condition: '', source: TsPackageEntrySource.SOURCE, targetPath: strip(facts.source) });
  }

  const rows: TsPackageEntryRegistry[] = [];
  for (const entry of entries) {
    let outcome: TsPackageEntryOutcome;
    let moduleHash = '';
    if (entry.targetPath === '') {
      outcome = TsPackageEntryOutcome.BLOCKED;
    } else if (entry.targetPath.includes('*')) {
      outcome = TsPackageEntryOutcome.PATTERN;
      // The pattern row stays as written; each module it publishes is a row of its own.
      for (const [subpath, targetPath, file] of sourceModulesForPattern(
        packageDir, entry.subpath, entry.targetPath, options.walkedFiles)) {
        const hash = options.moduleHashOf(path.normalize(file));
        if (hash !== undefined) {
          rows.push(new TsPackageEntryRegistry({
            packageName: facts.name,
            subpath,
            condition: entry.condition,
            entrySource: entry.source,
            targetPath,
            targetModuleLinkHash: hash,
            targetOutcome: TsPackageEntryOutcome.RESOLVED_FROM_PATTERN,
            packageJsonPath: options.packageJsonPath,
            serviceVersionLinkHash: options.serviceVersionLinkHash,
          }));
        }
      }
    } else {
      const found = sourceModuleFor(packageDir, entry.targetPath, options.moduleHashOf);
      if (found === undefined) {
        outcome = TsPackageEntryOutcome.NO_SOURCE_MODULE;
      } else {
        moduleHash = found[0];
        outcome = found[1]
          ? TsPackageEntryOutcome.RESOLVED
          : TsPackageEntryOutcome.RESOLVED_FROM_BUILD_OUTPUT;
      }
    }
    rows.push(new TsPackageEntryRegistry({
      packageName: facts.name,
      subpath: entry.subpath,
      condition: entry.condition,
      entrySource: entry.source,
      targetPath: entry.targetPath,
      targetModuleLinkHash: moduleHash,
      targetOutcome: outcome,
      packageJsonPath: options.packageJsonPath,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    }));
  }
  return rows;
}
