/**
 * What a `cs_type_heritage` row is — schema §3.3.
 *
 * ## Why the Java extends/implements split does NOT port
 *
 * `class C : A, IB` puts a base class and an interface in **one comma-separated
 * list with no keyword between them**, and only resolution says which is which.
 * Java's `JavaHeritageKind` reads `extends` and `implements` off the syntax; C#
 * has neither word. So the parser emits {@link BASE_OR_INTERFACE} and the engine
 * decides, and asserting more would be guessing.
 *
 * ## But syntax DOES decide for three of the five declaration forms
 *
 * A struct cannot have a base class. Neither can an interface, nor a record
 * struct. Every entry in their base lists is an interface **by the language's
 * rules, not by resolution**, and that is a fact the parser has for free.
 * Reporting it as `BASE_OR_INTERFACE` would throw away information and make the
 * engine re-derive something already known.
 *
 * The honest distinction is therefore between "syntax cannot tell" and "syntax
 * can", not between extends and implements.
 */
export enum CsHeritageKind {
  /**
   * **Position 0 of a class or record class base list, and nothing else.**
   *
   * This is the genuinely undecidable case and it is 69.9% of entries — 9,933 of
   * 14,217. `class C : A` and `class C : IFoo` are the same syntax, and only
   * resolution says whether `A` is a base class. The engine decides these.
   *
   * It is deliberately NOT the default for every entry in a class's list. v1 of
   * the schema collapsed that far and was discarding 3,218 entries' worth of
   * information the language settles by position alone.
   */
  BASE_OR_INTERFACE = 'BASE_OR_INTERFACE',

  /**
   * Known to be an interface, from syntax alone. **30.1% of entries.**
   *
   * Two independent rules produce it, and the second is the larger:
   *
   * 1. **The owner forbids a base class.** A struct, a record struct and an
   *    interface may list only interfaces — 1,066 entries measured.
   * 2. **POSITION.** A base class, if present, must be written FIRST. So on a
   *    class or record class, every entry at position ≥ 1 is an interface no
   *    matter what it is called — **3,218 entries**, three times the first rule.
   *
   * The position rule is easy to miss and worth stating plainly: "first entry
   * might be the base class" and "everything after the first is an interface"
   * are different claims, and only the second is decidable.
   */
  INTERFACE = 'INTERFACE',

  /**
   * `enum E : byte` — the **underlying storage type**, not a base type.
   *
   * `E` derives from `System.Enum`, never from `byte`. Emitting this as
   * `BASE_OR_INTERFACE` would tell the engine an enum derives from a primitive,
   * and dropping it would lose the storage width, which decides overflow and
   * marshalling. So it is its own kind.
   */
  ENUM_UNDERLYING_TYPE = 'ENUM_UNDERLYING_TYPE',

  /**
   * **Reserved, zero rows.** A `where T : IFoo` constraint, if constraints ever
   * move into this relation. They currently live on `cs_type_parameter`, where
   * the owning parameter is part of the identity.
   */
  TYPE_PARAMETER_CONSTRAINT = 'TYPE_PARAMETER_CONSTRAINT',
}
