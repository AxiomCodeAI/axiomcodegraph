/**
 * What a `using` brings into scope, and how far — `cs_using.usingKind`.
 *
 * ## Why an import relation has rows no file-walking extractor can produce
 *
 * Six of these seven are written in a file. **`IMPLICIT` is not written
 * anywhere.** `<ImplicitUsings>enable</ImplicitUsings>` in a `.csproj` — on in
 * 59 projects of the measured corpus — makes the SDK inject a set of namespaces
 * into every file of that project, and `System`, `System.Linq` and
 * `System.Collections.Generic` are then in scope with no directive to point at.
 *
 * A file-walking extractor produces zero rows for them, and the consequence is
 * not cosmetic: extension-method visibility is decided by the `using` set in
 * scope, so `xs.Where(…)` in a modern project is unresolvable without them.
 * They are emitted with `startLine = 0` and `originFile = ''` from the same
 * table that supplies `DefineConstants`.
 *
 * ## Why `STATIC` is not a flavour of `NAMESPACE`
 *
 * `using System.Math;` brings a TYPE into scope; `using static System.Math;`
 * brings its MEMBERS into scope unqualified, so a bare `Sqrt(x)` becomes a call
 * to `System.Math.Sqrt`. An engine that could not tell them apart would fail to
 * resolve every unqualified call under a `using static`.
 *
 * ## Why GLOBAL is in the kind rather than only in `isGlobal`
 *
 * Both are carried — `isGlobal` for a rule that does not care, the kind for one
 * that does. A `global using` applies to **every file in the compilation**, so
 * its scope is the assembly and not the file it happens to be written in. 33
 * files in the corpus carry one, and they govern thousands.
 */
export enum CsUsingKind {
  /** `using System.Text;` — a namespace, in this file. */
  NAMESPACE = 'NAMESPACE',

  /** `using static System.Math;` — a type's MEMBERS, unqualified, in this file. */
  STATIC = 'STATIC',

  /** `using Alias = A.B.C;` — a local name for a type or namespace. */
  ALIAS = 'ALIAS',

  /** `global using System;` — a namespace, in EVERY file of the compilation. */
  GLOBAL_NAMESPACE = 'GLOBAL_NAMESPACE',

  /** `global using static System.Math;` — members, everywhere. */
  GLOBAL_STATIC = 'GLOBAL_STATIC',

  /** `global using Alias = A.B.C;` — an alias, everywhere. */
  GLOBAL_ALIAS = 'GLOBAL_ALIAS',

  /**
   * SDK-injected. **Appears in no file anywhere.**
   *
   * `startLine = 0`, `originFile = ''`. Supplied as a parser INPUT, exactly as
   * `DefineConstants` is, because inferring it would mean evaluating MSBuild.
   */
  IMPLICIT = 'IMPLICIT',
}
