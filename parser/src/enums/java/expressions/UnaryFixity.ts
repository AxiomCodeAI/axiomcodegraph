/**
 * Distinguishes prefix from postfix unary operators.
 *
 * This is semantically important for increment/decrement operators:
 * - **PREFIX** (++i): Increment first, then use the value
 * - **POSTFIX** (i++): Use the value first, then increment
 *
 * Other unary operators (-x, !x, ~x, +x) are always prefix.
 *
 * ## Classification Examples
 *
 * ```java
 * public class UnaryExamples {
 *     private int count = 0;
 *
 *     // PREFIX - increment/decrement before use
 *     private int preIncrement = ++count;    // unaryFixity: PREFIX
 *     private int preDecrement = --count;    // unaryFixity: PREFIX
 *
 *     // POSTFIX - increment/decrement after use
 *     private int postIncrement = count++;   // unaryFixity: POSTFIX
 *     private int postDecrement = count--;   // unaryFixity: POSTFIX
 *
 *     // PREFIX only operators (no postfix form)
 *     private int negative = -value;         // unaryFixity: PREFIX
 *     private int positive = +value;         // unaryFixity: PREFIX
 *     private boolean negation = !flag;      // unaryFixity: PREFIX
 *     private int bitNot = ~bits;            // unaryFixity: PREFIX
 * }
 * ```
 *
 * ## Semantic Difference
 *
 * ```java
 * int i = 5;
 * int a = ++i;  // a = 6, i = 6 (increment then assign)
 * int b = i++;  // b = 6, i = 7 (assign then increment)
 * ```
 *
 * ## Usage
 *
 * This field is only relevant for UNARY_EXPRESSION kind.
 * Use in conjunction with the `operator` field.
 */
export enum UnaryFixity {
  /** Prefix operator (++i, --i, -x, !x, ~x, +x). Operator before operand. */
  PREFIX = 'PREFIX',

  /** Postfix operator (i++, i--). Operator after operand. */
  POSTFIX = 'POSTFIX',
}
