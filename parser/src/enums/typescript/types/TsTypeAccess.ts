/**
 * How visible a type declaration is.
 *
 * TypeScript visibility is EXPORT-based, not modifier-based, which is why Java's
 * `PACKAGE_ACCESS` has no member here and why the values name export forms
 * rather than keywords. There is no `public`/`private` on a type declaration.
 *
 * ## Examples
 *
 * ```ts
 * export class A { }              // EXPORTED_ACCESS
 * export default class B { }      // DEFAULT_EXPORT_ACCESS
 * class C { }                     // MODULE_LOCAL_ACCESS   (in a module file)
 * interface D { }                 // GLOBAL_ACCESS         (in a global script)
 * namespace N { interface E { } } // NAMESPACE_LOCAL_ACCESS (not exported from N)
 * ```
 *
 * `MODULE_LOCAL_ACCESS` and `GLOBAL_ACCESS` are the same syntax in different
 * files, and the difference is load-bearing: the first cannot be reached from
 * outside its file, the second merges with every other script's declarations.
 *
 * Schema §4.2 c4.
 */
export enum TsTypeAccess {
  /** `export class C` — reachable by name from an importing module. */
  EXPORTED_ACCESS = 'EXPORTED_ACCESS',

  /** `export default class C` — reachable under the binder's reserved name `default`. */
  DEFAULT_EXPORT_ACCESS = 'DEFAULT_EXPORT_ACCESS',

  /** Declared in a module file without `export` — unreachable from outside. */
  MODULE_LOCAL_ACCESS = 'MODULE_LOCAL_ACCESS',

  /** Declared in a global script, or inside `declare global`. */
  GLOBAL_ACCESS = 'GLOBAL_ACCESS',

  /** Declared inside a namespace without `export` — not reachable by qualified name. */
  NAMESPACE_LOCAL_ACCESS = 'NAMESPACE_LOCAL_ACCESS',
}
