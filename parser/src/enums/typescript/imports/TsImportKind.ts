/**
 * What an import row binds, and how.
 *
 * Positions 0–8 of `ts_import` mirror `java_import` with two slots repurposed:
 * Java's `isStatic` becomes `isTypeOnly` and its `isOnDemand` becomes
 * `isWildcard`, so the shared `import_wildcard` projection keeps its name.
 *
 * ## One declaration with N named specifiers emits N ROWS
 *
 * `import { a, type B }` is one declaration and two facts with DIFFERENT runtime
 * existence. A per-declaration row would have to pick one answer for
 * `isTypeOnly` and be wrong about the other. **45.6% of ecosystem import
 * declarations are type-only**, plus 34 using the inline `{ type X }` form, so
 * this is the common case rather than an edge one.
 *
 * ## Examples
 *
 * ```ts
 * import { a } from "m";              // NAMED
 * import { a as b } from "m";         // NAMED_ALIAS
 * import d from "m";                  // DEFAULT
 * import * as ns from "m";            // NAMESPACE            isWildcard = true
 * import "m";                         // SIDE_EFFECT          binds nothing
 * import type { T } from "m";         // TYPE_ONLY_NAMED
 * import type D from "m";             // TYPE_ONLY_DEFAULT
 * import type * as N from "m";        // TYPE_ONLY_NAMESPACE
 * import { type T, v } from "m";      // INLINE_TYPE_SPECIFIER (T) + NAMED (v)
 * import x = require("m");            // IMPORT_EQUALS_REQUIRE
 * import y = a.b.C;                   // IMPORT_EQUALS_ENTITY  — no module at all
 * const m = await import("m");        // DYNAMIC_IMPORT
 * const r = require("m");             // REQUIRE_CALL
 * /// <reference types="node" />      // TRIPLE_SLASH_REFERENCE
 * ```
 *
 * ## Three members that a statement-only walk misses entirely
 *
 * `DYNAMIC_IMPORT`, `REQUIRE_CALL` and `TRIPLE_SLASH_REFERENCE` are reachable
 * from no top-level import declaration — the first two live inside function
 * bodies and the third is a comment. They are still real module edges, and
 * without them the only record that the target file is reachable is gone.
 *
 * ## IMPORT_EQUALS_ENTITY names no module
 *
 * `import Units = Geometry.Units` aliases an ENTITY in the same file. An empty
 * `resolvedFilePath` is the CORRECT answer for it, not a failure — the hop is
 * the dotted path in `moduleOrEntityName`.
 *
 * Schema §4.12 c0.
 */
export enum TsImportKind {
  /** `import { a } from "m"`. */
  NAMED = 'NAMED',
  /** `import { a as b } from "m"`. */
  NAMED_ALIAS = 'NAMED_ALIAS',
  /** `import d from "m"` — binds the source module's `default` export. */
  DEFAULT = 'DEFAULT',
  /** `import * as ns from "m"`. Java's `TYPE_ON_DEMAND` slot. */
  NAMESPACE = 'NAMESPACE',
  /** `import "m"` — no binding, but a real module edge and often the only one. */
  SIDE_EFFECT = 'SIDE_EFFECT',
  /** `import type { T } from "m"` — no runtime existence. */
  TYPE_ONLY_NAMED = 'TYPE_ONLY_NAMED',
  /** `import type D from "m"`. */
  TYPE_ONLY_DEFAULT = 'TYPE_ONLY_DEFAULT',
  /** `import type * as N from "m"`. */
  TYPE_ONLY_NAMESPACE = 'TYPE_ONLY_NAMESPACE',
  /** `import { type T }` — type-only on the SPECIFIER, not the declaration. */
  INLINE_TYPE_SPECIFIER = 'INLINE_TYPE_SPECIFIER',
  /** `import x = require("m")` — the CommonJS interop form. */
  IMPORT_EQUALS_REQUIRE = 'IMPORT_EQUALS_REQUIRE',
  /** `import y = a.b.C` — an ENTITY alias; there is no module to resolve. */
  IMPORT_EQUALS_ENTITY = 'IMPORT_EQUALS_ENTITY',
  /** `import("m")` — reachable only from inside an expression. */
  DYNAMIC_IMPORT = 'DYNAMIC_IMPORT',
  /** `import("m").T` in a TYPE position. */
  TYPE_IMPORT_NODE = 'TYPE_IMPORT_NODE',
  /** `require("m")` — reachable only from inside an expression. */
  REQUIRE_CALL = 'REQUIRE_CALL',
  /** `/// <reference path=… />` or `types=…` — a module edge written as a comment. */
  TRIPLE_SLASH_REFERENCE = 'TRIPLE_SLASH_REFERENCE',
}
