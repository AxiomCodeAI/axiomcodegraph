import * as fs from 'fs';
import * as path from 'path';

import { JsModuleSystem, JsModuleSystemSource } from '@/enums/javascript/modules';
import { jsExtensionOf } from '@/utils/javascript';

/**
 * Which `package.json` GOVERNS a `.js` file, and therefore whether it is
 * CommonJS or ESM.
 *
 * ## Why this is the first thing built, and built once
 *
 * `js_module.moduleSystem` is **in the primary key**, so this answer propagates
 * into every child hash in the fact base. A wrong answer does not produce a
 * wrong column — it partitions two identical programs into two incomparable
 * fact sets, or merges two different ones. There is no later pass that can
 * correct it.
 *
 * ## This is §9 of `BUILDING-A-PARSER.md` in its nastier form
 *
 * *Read the governing config per file, never one config per run.* TypeScript
 * has the same rule for `tsconfig.json`, but JavaScript's version is worse in
 * three specific ways:
 *
 * 1. **The governing file is frequently not in the repository.** A `.js` file
 *    inside a dependency is governed by that dependency's own `package.json`,
 *    and a loose script directory is governed by nothing at all — 15.4% of the
 *    measured corpus has no `package.json` anywhere up the tree.
 * 2. **There is no `include`/`exclude`.** Nearest ancestor wins, full stop. A
 *    `package.json` cannot disown a file, so unlike `TsConfigResolver` the walk
 *    stops at the first one found rather than continuing past a config that
 *    does not claim the file.
 * 3. **`.mjs` and `.cjs` override it outright.** They are not hints and they do
 *    not merely win a tie: the extension *is* the declaration, and no
 *    `package.json` can contradict it. So the extension check happens before
 *    the walk, not after it.
 *
 * ## What "nearest ancestor" means precisely
 *
 * Node's rule, which this implements: walk from the file's own directory
 * upward, and the **first** directory containing a `package.json` decides.
 * Absence of a `"type"` field in that file is a real answer — the spec's default
 * is CommonJS — and it is recorded distinctly from an explicit
 * `"type": "commonjs"` (`PKG_TYPE_ABSENT_DEFAULT` versus
 * `PKG_TYPE_COMMONJS`), because 76.0% of files land on the former and they are
 * not making the same claim.
 *
 * ## No Program, no network, no install
 *
 * Reading a `package.json` is `fs.readFileSync` and `JSON.parse`. Nothing here
 * resolves a module, typechecks anything, or needs `node_modules` to exist.
 *
 * ## Caching discipline
 *
 * Two caches, both keyed on **absolute directory paths** — never on a node, a
 * file object, or anything with an identity that can be recycled. The
 * per-directory cache is what makes this O(depth) once rather than O(files ×
 * depth): a 1,045-file package shares one answer for its whole subtree.
 */
export interface GoverningPackageJson {
  /**
   * Absolute path of the deciding `package.json`; `""` when none was found.
   *
   * Recorded in `js_module.governingPackageJsonPath` as *evidence*, and
   * deliberately kept out of the module's primary key: evidence moving without
   * the conclusion moving must not cascade every child hash.
   */
  readonly packageJsonPath: string;
  readonly moduleSystem: JsModuleSystem;
  readonly moduleSystemSource: JsModuleSystemSource;
  /** `name` from the deciding `package.json`; `""` when absent or unnamed. */
  readonly packageName: string;
}

/** What one `package.json` says, once parsed. */
export interface PackageJsonFacts {
  readonly path: string;
  /** `undefined` when the file has no `"type"` field — which is 76.0% of them. */
  readonly type: 'module' | 'commonjs' | undefined;
  readonly name: string;
  /**
   * The entry-point fields, as written (#616). `main` and `module` when they are
   * strings; `exports` in any of its shapes (string, array, subpath map,
   * conditions), left for `package-entry-extractor.ts` to walk. `undefined`
   * where the field is absent or not a shape Node reads.
   */
  readonly main: string | undefined;
  readonly module: string | undefined;
  readonly exports: unknown;
}

export class PackageJsonResolver {
  /** Parsed facts by absolute `package.json` path. `undefined` = unreadable. */
  private readonly parsed = new Map<string, PackageJsonFacts | undefined>();

  /**
   * Nearest-ancestor answer by absolute DIRECTORY path.
   *
   * Keyed on the directory rather than the file because every file in a
   * directory shares the answer, and the walk is the expensive part.
   */
  private readonly byDirectory = new Map<string, PackageJsonFacts | undefined>();

  /**
   * The module system in force FOR THIS FILE.
   *
   * @param absoluteFilePath absolute, normalised path of the `.js`/`.mjs`/`.cjs` file
   */
  resolve(absoluteFilePath: string): GoverningPackageJson {
    // The extension check is FIRST and it is total. `.mjs` is an ES module and
    // `.cjs` is CommonJS whatever any config says, so consulting the config
    // first and then overriding would be doing work whose answer is discarded —
    // and would invite a future edit that lets the config win.
    // `jsExtensionOf`, not `path.extname`. The override `.cjs` makes is TOTAL,
    // and `path.extname('a.cjs.flow')` is `.flow` — so the one extension whose
    // whole point is that no config can overrule it was being overruled by a
    // suffix. Same trap that made the walker blind to Flow declaration files.
    const extension = jsExtensionOf(path.basename(absoluteFilePath));
    if (extension === '.mjs' || extension === '.cjs') {
      // The nearest package.json is still read, for `packageName` and for the
      // evidence column. It just does not decide the module system.
      const nearest = this.nearest(path.dirname(absoluteFilePath));
      return {
        packageJsonPath: nearest?.path ?? '',
        moduleSystem: extension === '.mjs' ? JsModuleSystem.ESM : JsModuleSystem.COMMONJS,
        moduleSystemSource: extension === '.mjs'
          ? JsModuleSystemSource.EXT_MJS
          : JsModuleSystemSource.EXT_CJS,
        packageName: nearest?.name ?? '',
      };
    }

    const nearest = this.nearest(path.dirname(absoluteFilePath));
    if (nearest === undefined) {
      return {
        packageJsonPath: '',
        moduleSystem: JsModuleSystem.COMMONJS,
        moduleSystemSource: JsModuleSystemSource.NO_PACKAGE_JSON_DEFAULT,
        packageName: '',
      };
    }
    if (nearest.type === 'module') {
      return {
        packageJsonPath: nearest.path,
        moduleSystem: JsModuleSystem.ESM,
        moduleSystemSource: JsModuleSystemSource.PKG_TYPE_MODULE,
        packageName: nearest.name,
      };
    }
    if (nearest.type === 'commonjs') {
      return {
        packageJsonPath: nearest.path,
        moduleSystem: JsModuleSystem.COMMONJS,
        moduleSystemSource: JsModuleSystemSource.PKG_TYPE_COMMONJS,
        packageName: nearest.name,
      };
    }
    // A package.json with no `"type"`. CommonJS by the spec's default — a real
    // answer, recorded as a DEFAULT so it is never mistaken for a declaration.
    return {
      packageJsonPath: nearest.path,
      moduleSystem: JsModuleSystem.COMMONJS,
      moduleSystemSource: JsModuleSystemSource.PKG_TYPE_ABSENT_DEFAULT,
      packageName: nearest.name,
    };
  }

  /**
   * The `package.json` sitting DIRECTLY in `directory`, if there is one.
   *
   * No walk: this is the question "is this directory a package", asked of a
   * walk root (#620) and of every governing config (#616), not "which package
   * governs this file".
   */
  packageAt(directory: string): PackageJsonFacts | undefined {
    return this.read(path.join(directory, 'package.json'));
  }

  /**
   * Walks up from `directory` to the filesystem root, first `package.json` wins.
   *
   * Unlike `TsConfigResolver.resolve`, a found config never "disowns" the file,
   * so there is no reason to continue the walk past it. That is Node's rule and
   * it is the rule the runtime actually applies.
   *
   * Every directory visited is memoised with the answer, not just the starting
   * one, so a deep tree costs one walk in total rather than one per level.
   */
  private nearest(directory: string): PackageJsonFacts | undefined {
    const cached = this.byDirectory.get(directory);
    if (cached !== undefined || this.byDirectory.has(directory)) {
      return cached;
    }

    const visited: string[] = [];
    let current = directory;
    let answer: PackageJsonFacts | undefined;
    for (;;) {
      const seen = this.byDirectory.has(current);
      if (seen) {
        answer = this.byDirectory.get(current);
        break;
      }
      visited.push(current);
      const candidate = path.join(current, 'package.json');
      const facts = this.read(candidate);
      if (facts !== undefined) {
        answer = facts;
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        // Filesystem root reached with nothing found. `undefined` is the
        // answer, and it is a legitimate one: 15.4% of real files have no
        // governing package.json at all.
        answer = undefined;
        break;
      }
      current = parent;
    }
    for (const seenDirectory of visited) {
      this.byDirectory.set(seenDirectory, answer);
    }
    return answer;
  }

  /**
   * Reads and parses one `package.json`, or returns `undefined`.
   *
   * A malformed `package.json` is treated as absent rather than as an error.
   * The alternative — failing the file — would make one unparseable config in a
   * vendored directory abort analysis of a tree that Node itself would happily
   * run, since Node only reads the field it needs.
   *
   * `"type"` is only honoured when it is exactly `"module"` or `"commonjs"`.
   * Anything else is not a value Node recognises, so it is treated as absent,
   * which is what Node does.
   */
  private read(packageJsonPath: string): PackageJsonFacts | undefined {
    if (this.parsed.has(packageJsonPath)) {
      return this.parsed.get(packageJsonPath);
    }
    let facts: PackageJsonFacts | undefined;
    try {
      const raw = fs.readFileSync(packageJsonPath, 'utf-8');
      const json = JSON.parse(raw) as {
        type?: unknown; name?: unknown; main?: unknown; module?: unknown; exports?: unknown;
      };
      const declared = json.type === 'module' || json.type === 'commonjs'
        ? json.type
        : undefined;
      facts = {
        path: packageJsonPath,
        type: declared,
        name: typeof json.name === 'string' ? json.name : '',
        main: typeof json.main === 'string' ? json.main : undefined,
        module: typeof json.module === 'string' ? json.module : undefined,
        exports: json.exports,
      };
    } catch {
      facts = undefined;
    }
    this.parsed.set(packageJsonPath, facts);
    return facts;
  }
}
