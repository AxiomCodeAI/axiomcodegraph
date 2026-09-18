/**
 * The nullable-reference-type context in force — `cs_module.nullableContextDefault`
 * and `cs_type.nullableContext`.
 *
 * ## Why this is not one value per file
 *
 * `#nullable` is **per-file, per-region, and overridable mid-file**, and it is
 * also defaulted by the `.csproj`. 497 `#nullable` directives were measured in
 * the corpus, **453 of them `disable`** — that is, the overwhelmingly common use
 * is to switch the context OFF for a region of a project that is otherwise on.
 *
 * So the module carries the *default* the governing configuration gives it, and
 * every declaration carries the context actually in force at its own position.
 * Reading the module's value and assuming it holds for the whole file is wrong
 * 453 times in the corpus, and wrong silently: the type name does not change.
 *
 * ## Why `string?` is not enough on its own
 *
 * In a `disable` context, `string?` on a reference type is a warning and means
 * nothing, and a bare `string` makes no claim at all. In an `enable` context,
 * bare `string` is a claim of non-nullness. The annotation is the same text; the
 * meaning is opposite. `isNullableAnnotated` records the text, this records what
 * the text means.
 */
export enum CsNullableContext {
  /** `#nullable enable` — both annotations and warnings. */
  ENABLE = 'ENABLE',

  /** `#nullable disable` — the C# 7 world. 453 of 497 directives. */
  DISABLE = 'DISABLE',

  /** `#nullable enable annotations` — annotations honoured, warnings off. */
  ANNOTATIONS = 'ANNOTATIONS',

  /** `#nullable enable warnings` — warnings on, annotations not honoured. */
  WARNINGS = 'WARNINGS',

  /**
   * `#nullable restore`, or no directive and no project default.
   *
   * Distinct from `DISABLE`: "restore to whatever the project said" and "off"
   * are the same only when the project said off, and the parser is not told
   * which unless a `.csproj` governs the file.
   */
  INHERITED = 'INHERITED',
}
