/**
 * Describes the kind of comment in Java source code.
 *
 * This enumeration classifies comments by their syntactic form, which
 * determines their purpose and rendering behavior in documentation tools.
 *
 * ## Comment Kinds
 *
 * - **LINE_COMMENT** – Single-line `//` comments
 * - **BLOCK_COMMENT** – Multi-line `/* ... *​/` comments
 * - **JAVADOC** – Documentation `/** ... *​/` comments (rendered by javadoc tool)
 *
 * ## Examples
 *
 * ```java
 * // LINE_COMMENT - single-line comment starting with //
 * // This is a line comment
 * private int count = 0;
 *
 * // Multiple line comments before the same entity get grouped
 * // with ascending commentIndex (0, 1, 2, ...)
 * // Each is a separate LINE_COMMENT with the same ownerHash
 * private String name = "default";
 *
 * // BLOCK_COMMENT - multi-line comment delimited by /* ... *​/
 * /* This is a block comment
 *    spanning multiple lines *​/
 * public void process() { }
 *
 * // JAVADOC - documentation comment delimited by /** ... *​/
 * // Distinguished from BLOCK_COMMENT by the leading /** (double asterisk)
 * /**
 *  * Calculates the total price including tax.
 *  *
 *  * @param price the base price
 *  * @param taxRate the tax rate as a decimal
 *  * @return the total price
 *  *​/
 * public double calculateTotal(double price, double taxRate) {
 *     return price * (1 + taxRate);
 * }
 * ```
 *
 * ## End-of-Line Comments
 *
 * ```java
 * int x = 42;  // LINE_COMMENT on same line as declaration
 *              // linked to the entity on the same line (the field/variable)
 * ```
 *
 * ## Association Model
 *
 * Each comment is linked to an owner entity via `ownerHash`:
 * - Comments before a type declaration → linked to TYPE_REGISTRY
 * - Comments before a method → linked to METHOD_REGISTRY
 * - Comments before a field → linked to FIELD_REGISTRY
 * - Comments before a local variable → linked to LOCAL_VARIABLE_REGISTRY
 * - Comments before an annotation → linked to TYPE_ANNOTATION
 * - Comments before an expression statement → linked to EXPRESSION_REFERENCE
 *
 * ## Tree-sitter AST Representation
 *
 * In the tree-sitter Java grammar:
 * - `//` comments produce `line_comment` nodes
 * - `/* ... *​/` and `/** ... *​/` both produce `block_comment` nodes
 * - Javadoc is distinguished from block comments by checking if text starts with `/**`
 * - Comments are sibling nodes of declarations in `class_body`, `block`, and `program`
 */
export enum CommentKind {
  /** Single-line comment: `// ...` */
  LINE_COMMENT = 'LINE_COMMENT',

  /** Multi-line block comment: `/* ... *​/` */
  BLOCK_COMMENT = 'BLOCK_COMMENT',

  /** Javadoc documentation comment: `/** ... *​/` */
  JAVADOC = 'JAVADOC',
}
