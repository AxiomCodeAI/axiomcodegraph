/**
 * Where a type declaration sits — `cs_type.typePlacement`.
 *
 * The values Java has, plus the one C# adds. Placement decides the default
 * accessibility and it decides the shape of `declarationScopeKey`, so it is
 * read rather than merely reported.
 */
export enum CsTypePlacement {
  /** Directly in a namespace, or in the global namespace. */
  TOP_LEVEL = 'TOP_LEVEL',

  /** Declared inside another type. `declarationScopeKey` is `NESTED:<parent group>`. */
  NESTED = 'NESTED',

  /**
   * The synthetic type that owns a file's top-level statements.
   *
   * C# 9 lets a file contain statements with no type and no method around them.
   * The compiler synthesizes `Program.<Main>$`; there is no declaration syntax
   * to key on and no name in the source. Without a row here the file's
   * statements have no owner, and `cs_expression` requires one.
   */
  TOP_LEVEL_STATEMENTS = 'TOP_LEVEL_STATEMENTS',
}
