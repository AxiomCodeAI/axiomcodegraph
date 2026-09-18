/**
 * How a compilation unit declares its namespace — `cs_module.namespaceStyle`.
 *
 * Measured over the 9,568-file corpus: **7,626 file-scoped against 1,795 block**,
 * so the modern form is the common one and neither can be treated as the
 * exception. 13 files declare more than one namespace.
 *
 * ## Why this is a column and not an inference
 *
 * The two forms differ in what they SCOPE. A block namespace can be followed by
 * a second one, and a `using` written between them applies only to what comes
 * after it. A file-scoped namespace runs to end-of-file and cannot be nested, so
 * every `using` in the file governs every declaration in it. An extension
 * method's visibility depends on exactly that, so the engine needs to know which
 * shape it is looking at without re-reading the source.
 */
export enum CsNamespaceStyle {
  /** `namespace N;` — C# 10, runs to end of file. 7,626 files. */
  FILE_SCOPED = 'FILE_SCOPED',

  /** `namespace N { … }` — braced, may be nested, may repeat. 1,795 files. */
  BLOCK = 'BLOCK',

  /**
   * No namespace declaration at all: the file's types are in the global
   * namespace. Legal, and the shape a top-level-statements file usually has.
   */
  NONE = 'NONE',

  /**
   * More than one namespace in one file, or both styles present.
   *
   * 13 files. Rare enough to be tempting to fold into `BLOCK`, and wrong to:
   * `csNamespaceName` on the module row can then name only one of them, and a
   * consumer that did not know would attribute every type to the first.
   */
  MIXED = 'MIXED',
}
