/**
 * Classifies the type of literal value in a LITERAL expression.
 *
 * This enumeration provides fine-grained classification of literal values,
 * enabling precise representation and analysis of constant expressions.
 *
 * ## Literal Categories
 *
 * - **Numeric** – Integer, long, float, double
 * - **Boolean** – true, false
 * - **Character** – Single character ('a', '\n')
 * - **String** – Regular strings and text blocks
 * - **Null** – null literal
 *
 * ## Classification Examples
 *
 * ```java
 * public class LiteralExamples {
 *     // INTEGER - int literals (decimal, hex, octal, binary)
 *     private int decimal = 42;               // literalType: INTEGER
 *     private int hex = 0x2A;                 // literalType: INTEGER
 *     private int octal = 052;                // literalType: INTEGER
 *     private int binary = 0b101010;          // literalType: INTEGER
 *     private int underscore = 1_000_000;     // literalType: INTEGER
 *
 *     // LONG - long literals (suffix L or l)
 *     private long bigNum = 42L;              // literalType: LONG
 *     private long timestamp = 1234567890L;   // literalType: LONG
 *
 *     // FLOAT - float literals (suffix f or F)
 *     private float pi = 3.14f;               // literalType: FLOAT
 *     private float scientific = 1.5e-4f;     // literalType: FLOAT
 *
 *     // DOUBLE - double literals (default for decimals, suffix d or D)
 *     private double precise = 3.14159265;    // literalType: DOUBLE
 *     private double explicit = 3.14d;        // literalType: DOUBLE
 *     private double sci = 1.5e10;            // literalType: DOUBLE
 *
 *     // BOOLEAN - true/false
 *     private boolean active = true;          // literalType: BOOLEAN
 *     private boolean disabled = false;       // literalType: BOOLEAN
 *
 *     // CHARACTER - single character in single quotes
 *     private char letter = 'a';              // literalType: CHARACTER
 *     private char newline = '\n';            // literalType: CHARACTER
 *     private char unicode = '\u0041';        // literalType: CHARACTER
 *     private char tab = '\t';                // literalType: CHARACTER
 *
 *     // STRING - double-quoted strings
 *     private String name = "John";           // literalType: STRING
 *     private String empty = "";              // literalType: STRING
 *     private String escaped = "Hello\nWorld"; // literalType: STRING
 *
 *     // TEXT_BLOCK - triple-quoted strings (Java 15+)
 *     private String json = """
 *         {
 *             "name": "John"
 *         }
 *         """;                                // literalType: TEXT_BLOCK
 *
 *     // NULL - null literal
 *     private Object nothing = null;          // literalType: NULL
 *     private String unset = null;            // literalType: NULL
 * }
 * ```
 *
 * ## Notes
 *
 * - **Class literals** (String.class) use ExpressionKind.CLASS_LITERAL, not LITERAL
 * - **resolvedValue** field stores the actual parsed value as string
 * - **rawText** preserves original format (0x2A vs 42)
 */
export enum LiteralType {
  /** Integer literal (42, 0x2A, 0b101010, 1_000). */
  INTEGER = 'INTEGER',

  /** Long literal with L suffix (42L, 1234567890L). */
  LONG = 'LONG',

  /** Float literal with f/F suffix (3.14f, 1.5e-4F). */
  FLOAT = 'FLOAT',

  /** Double literal (3.14, 3.14d, 1.5e10). Default for decimal literals. */
  DOUBLE = 'DOUBLE',

  /** Boolean literal (true, false). */
  BOOLEAN = 'BOOLEAN',

  /** Character literal in single quotes ('a', '\n', '\u0041'). */
  CHARACTER = 'CHARACTER',

  /** String literal in double quotes ("hello", "line\nbreak"). */
  STRING = 'STRING',

  /** Text block literal with triple quotes (Java 15+). */
  TEXT_BLOCK = 'TEXT_BLOCK',

  /** Null literal (null). */
  NULL = 'NULL',
}
