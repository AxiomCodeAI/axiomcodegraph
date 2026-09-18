/**
 * Modifiers on a type declaration — `cs_type.typeModifiers`, a sorted comma-set.
 *
 * A SET column and not one kind per combination: `public sealed partial record`
 * is four independent facts, and multiplying them into categories is the mistake
 * §3 of `BUILDING-A-PARSER.md` names — the variant belongs in a field.
 *
 * The load-bearing ones are also promoted to their own boolean columns
 * (`isPartial`, `isStatic`, `isAbstract`, `isSealed`, `isReadOnly`,
 * `isRefLikeStruct`, `isFileLocal`, `isRecord`). That is deliberate duplication:
 * the set is the complete record of what was written, and the booleans are what
 * a rule joins on without parsing a comma-set.
 */
export enum CsTypeModifier {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  PROTECTED = 'PROTECTED',
  INTERNAL = 'INTERNAL',
  STATIC = 'STATIC',
  ABSTRACT = 'ABSTRACT',
  SEALED = 'SEALED',

  /** One type, N declarations, one entity. See `cs_type.declarationGroupKey`. */
  PARTIAL = 'PARTIAL',

  /** `readonly struct` — every instance member is implicitly readonly. */
  READONLY = 'READONLY',

  /** `ref struct` — stack-only. Cannot be boxed, captured, or held by a class. */
  REF = 'REF',

  /** `unsafe` — the body may contain pointers and `fixed` buffers. */
  UNSAFE = 'UNSAFE',

  /** `new` on a nested type, hiding an inherited one of the same name. */
  NEW = 'NEW',

  /**
   * `file class C` — C# 11. Visible only within the declaring FILE.
   *
   * Two files may declare `file class C` in the same namespace and they are two
   * different types. A group key that ignored this would merge them, so
   * `isFileLocal` participates in `declarationScopeKey`.
   */
  FILE = 'FILE',

  /**
   * A type with NO declaration syntax that the compiler nevertheless declares:
   * the `Program` that holds a file's top-level statements. Roslyn reports it
   * with one DeclaringSyntaxReference pointing at the compilation unit, so it
   * is adjudicable, and a user-written `partial class Program` MERGES with it
   * (ruling v1.6 §4.0.3) — which is why the synthesised row is `isPartial`
   * without a `partial` keyword anywhere.
   */
  SYNTHESIZED = 'SYNTHESIZED',
}
