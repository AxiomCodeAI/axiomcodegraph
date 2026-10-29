/**
 * WHERE a specifier landed, as `ts.resolveModuleName` reported it.
 *
 * ## This column is parser-legal, and that is not obvious
 *
 * `ts.resolveModuleName` needs **no `ts.Program`**: it is a pure function of a
 * specifier, compiler options and a host, and it returns `undefined` for an
 * unresolvable specifier rather than guessing. That is what makes
 * `resolvedFilePath` a parser column rather than engine work — and it matters
 * beyond imports, because a module augmentation's merge key is keyed on the
 * RESOLVED target module.
 *
 * ## The distinction the engine cannot make without this column
 *
 * `resolvedFilePath` is empty for three completely different reasons, and only
 * one of them is a problem:
 *
 * ```ts
 * import * as path from "path";   // BUILTIN_NODE   — no file, and none needed
 * import { T } from "some-pkg";   // AMBIENT_MODULE — a `declare module` in this analysis
 * import { U } from "./missing";  // UNRESOLVED     — genuinely not found
 * ```
 *
 * Collapsing them means the engine cannot tell a Node builtin from a project
 * import that failed. Measured on one repository: unprefixed Node builtins
 * accounted for **241 of 259** apparently-incomplete import hops.
 *
 * `UNRESOLVED` is an honest negative about THIS analysis, not a claim about the
 * outside world.
 *
 * Schema §4.12 c16.
 */
export enum TsImportResolutionKind {
  /** A relative specifier that resolved to a file. */
  RELATIVE_FILE = 'RELATIVE_FILE',
  /** Resolved through a tsconfig `paths` mapping, or a Deno import-map entry onto a project file. */
  PATHS_ALIAS = 'PATHS_ALIAS',
  /** Resolved to a `.d.ts` inside `node_modules`. */
  NODE_MODULES_TYPES = 'NODE_MODULES_TYPES',
  /** Resolved to source inside `node_modules`. */
  NODE_MODULES_SOURCE = 'NODE_MODULES_SOURCE',
  /** Resolved through a package's `exports` map. */
  PACKAGE_EXPORTS = 'PACKAGE_EXPORTS',
  /**
   * A package this repository declares, imported by its name: bound to the walked
   * source its `main` / `types` / `exports` entry is built from.
   */
  WORKSPACE_PACKAGE = 'WORKSPACE_PACKAGE',
  /**
   * A `jsr:` package (directly, or through a Deno import map), resolved to the
   * version the lockfile pins and the file its `exports` names. The path is the
   * module's copy in the project's Deno mirror, laid out as `vendor/` is.
   */
  JSR_PACKAGE = 'JSR_PACKAGE',
  /** An `npm:` package resolved inside Deno's own npm cache rather than `node_modules`. */
  DENO_NPM_CACHE = 'DENO_NPM_CACHE',
  /** An `https:` module a Deno project imports by URL, as downloaded (redirects and `x-typescript-types` followed). */
  REMOTE_MODULE = 'REMOTE_MODULE',
  /** Matched a `declare module "x"` in this analysis. No file, and none needed. */
  AMBIENT_MODULE = 'AMBIENT_MODULE',
  /** A Node builtin, with or without the `node:` prefix. */
  BUILTIN_NODE = 'BUILTIN_NODE',
  /** Not found. An honest negative, and distinguishable from the two above. */
  UNRESOLVED = 'UNRESOLVED',
}
