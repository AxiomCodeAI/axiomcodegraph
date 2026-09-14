/**
 * What kind of module a `ts_module` row describes.
 *
 * TypeScript needs this enum where Java needs none, because a "module" here is
 * three things at once: the unit of import resolution, the symbol MERGE TABLE
 * that declaration merging keys off, and the boundary between module scope and
 * global scope. Java's package is implicit in a qualified name and carries none
 * of those roles.
 *
 * ## The distinction that matters most
 *
 * `SOURCE_MODULE` versus `SCRIPT_GLOBAL` is decided by a single question — does
 * the file have a top-level `import` or `export`? — and the answer changes which
 * table every declaration in the file lands in. A script's declarations go to
 * `GLOBAL` and merge with every other script's; a module's go to that module's
 * own table and merge with nothing outside it.
 *
 * ## Examples
 *
 * ```ts
 * // views.ts  — has a top-level import  →  SOURCE_MODULE
 * import { User } from "./user";
 * export interface View { user: User }
 *
 * // globals.ts — no import, no export   →  SCRIPT_GLOBAL
 * interface AppConfig { readonly name: string }
 *
 * // api.d.ts                            →  DECLARATION_FILE
 * export declare function get(url: string): Promise<string>;
 *
 * // inside any file:
 * declare module "untyped-legacy-pkg" { }  →  AMBIENT_MODULE_DECLARATION
 * declare module "./augmented-base" { }    →  MODULE_AUGMENTATION
 * declare global { }                       →  GLOBAL_AUGMENTATION
 * ```
 *
 * **What gets extracted** from one file holding two `declare module` blocks and a
 * `declare global`: **four** `ts_module` rows — the file itself plus one per
 * block. That is why `declaredSpecifier` and `startLine` are both in the primary
 * key: 173 ambient module declarations were measured across a corpus, several
 * files holding more than one.
 *
 * Schema §4.1 c5.
 */
export enum TsModuleKind {
  /** A `.ts`/`.mts`/`.cts` file with a top-level `import` or `export`. */
  SOURCE_MODULE = 'SOURCE_MODULE',

  /**
   * A file with NO top-level import or export.
   *
   * Its declarations land in GLOBAL scope, which is what lets two such files
   * declare halves of one interface and have them merge.
   */
  SCRIPT_GLOBAL = 'SCRIPT_GLOBAL',

  /** A `.d.ts` file: declarations with no bodies. */
  DECLARATION_FILE = 'DECLARATION_FILE',

  /**
   * `declare module "some-package" { … }` with a non-relative specifier.
   *
   * An independently importable namespace, and a merge scope of its own. Two
   * files declaring `declare module "*.svg"` declare ONE symbol.
   */
  AMBIENT_MODULE_DECLARATION = 'AMBIENT_MODULE_DECLARATION',

  /**
   * `declare module "./local-file" { … }` with a relative specifier.
   *
   * Reopens an EXISTING module and adds to it — how every plugin ecosystem in
   * TypeScript extends its host. The declarations inside belong to the TARGET
   * module's table, not to the declaring file's.
   */
  MODULE_AUGMENTATION = 'MODULE_AUGMENTATION',

  /** `declare global { … }`: a module contributing to the global scope. */
  GLOBAL_AUGMENTATION = 'GLOBAL_AUGMENTATION',

  /** A `.json` file imported under `resolveJsonModule`. */
  JSON_MODULE = 'JSON_MODULE',
}
