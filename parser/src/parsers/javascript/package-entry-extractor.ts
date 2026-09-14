import * as fs from 'fs';
import * as path from 'path';

import { JsPackageEntryRegistry } from '@/analysis-types/javascript/JsPackageEntryRegistry';

/**
 * What a `package.json` EXPOSES, as rows: one per (specifier, condition).
 *
 * Read once per governing `package.json` the walk met, from the file the
 * `PackageJsonResolver` already read for `"type"`. No module resolution runs
 * here: the target is the path the manifest writes, normalised, and the
 * `index.js` fallback for a `main` that names a directory or omits its
 * extension is the one piece of Node's algorithm applied, because without it a
 * `main` is unusable by a consumer that has only these rows.
 *
 * - `main` -> `<name>` / `default`. Absent `main` and absent `exports` ->
 *   `index.js` when it exists.
 * - `exports` string -> `<name>` / `default`.
 * - `exports` object: keys starting with `.` are subpaths (`.` is the root,
 *   `./sub` is `<name>/sub`, `./*` stays literal as `<name>/*`); other keys are
 *   conditions on the root. A nested object is a condition tree; the row's
 *   condition is the key path joined with `,` (`node,import`). An array is the
 *   first usable element (the fallback list's first candidate).
 * - `module` / `browser` fields as strings -> `<name>` / `module` | `browser`.
 *
 * A target that does not exist on disk is emitted with its path and no module
 * link: a named absence, never a guess.
 */
export function extractPackageEntries(init: {
  packageJsonPath: string;
  packageName: string;
  toRelative: (absolute: string) => string;
  /** absolute normalised file path -> js_module hash, for every extracted file */
  projectModuleHashes: ReadonlyMap<string, string>;
  serviceVersionLinkHash: string;
}): JsPackageEntryRegistry[] {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(init.packageJsonPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (init.packageName === '') return [];
  const dir = path.dirname(init.packageJsonPath);
  const rows: JsPackageEntryRegistry[] = [];
  const seen = new Set<string>();
  const emit = (specifier: string, condition: string, target: string): void => {
    const key = `${specifier} ${condition}`;
    if (seen.has(key)) return;
    seen.add(key);
    const absolute = resolveTarget(dir, target);
    rows.push(new JsPackageEntryRegistry({
      packageName: init.packageName,
      specifier,
      condition,
      targetFilePath: init.toRelative(absolute),
      targetModuleLinkHash: init.projectModuleHashes.get(path.normalize(absolute)) ?? '',
      packageJsonPath: init.toRelative(init.packageJsonPath),
      serviceVersionLinkHash: init.serviceVersionLinkHash,
    }));
  };
  const specifierFor = (subpath: string): string =>
    subpath === '.' ? init.packageName : `${init.packageName}/${subpath.replace(/^\.\//, '')}`;
  const walk = (subpath: string, value: unknown, conditions: string[]): void => {
    if (typeof value === 'string') {
      emit(specifierFor(subpath), conditions.length === 0 ? 'default' : conditions.join(','), value);
      return;
    }
    if (Array.isArray(value)) {
      const first = value.find((v) => typeof v === 'string' || (v !== null && typeof v === 'object'));
      if (first !== undefined) walk(subpath, first, conditions);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === null) continue; // `"./x": null` blocks a subpath
        walk(subpath, v, [...conditions, k]);
      }
    }
  };
  const exportsField = manifest.exports;
  if (exportsField !== undefined && exportsField !== null) {
    if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
      walk('.', exportsField, []);
    } else if (typeof exportsField === 'object') {
      const entries = Object.entries(exportsField as Record<string, unknown>);
      const subpathKeys = entries.filter(([k]) => k.startsWith('.'));
      if (subpathKeys.length > 0) {
        for (const [k, v] of subpathKeys) walk(k, v, []);
      } else {
        // conditions on the root: `{ "require": ..., "import": ... }`
        walk('.', exportsField, []);
      }
    }
  }
  if (typeof manifest.main === 'string' && manifest.main !== '') {
    emit(init.packageName, 'default', manifest.main);
  } else if (exportsField === undefined || exportsField === null) {
    if (fs.existsSync(path.join(dir, 'index.js'))) emit(init.packageName, 'default', './index.js');
  }
  if (typeof manifest.module === 'string') emit(init.packageName, 'module', manifest.module);
  if (typeof manifest.browser === 'string') emit(init.packageName, 'browser', manifest.browser);
  return rows;
}

/** The manifest's target as a file: a directory or an extension-less path gets Node's `main` fallbacks. */
function resolveTarget(dir: string, target: string): string {
  const absolute = path.resolve(dir, target);
  try {
    const st = fs.statSync(absolute);
    if (st.isFile()) return absolute;
    if (st.isDirectory()) return path.join(absolute, 'index.js');
  } catch {
    // fall through to the extension candidates
  }
  for (const ext of ['.js', '.cjs', '.mjs', '.json']) {
    if (fs.existsSync(absolute + ext)) return absolute + ext;
  }
  return absolute;
}
