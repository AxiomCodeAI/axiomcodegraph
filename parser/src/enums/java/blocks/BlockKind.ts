/**
 * Identifies the type of code block that can contain expressions and local variables.
 *
 * This enumeration describes block-level constructs that create a scope or
 * logical grouping for the code inside them.
 *
 * ## Block Categories
 *
 * - **Exception Handling** – try, catch, finally, try-with-resources
 * - **Loops** – for, enhanced for, while, do-while
 * - **Conditionals** – if, else-if, else, switch case
 * - **Synchronization** – synchronized block
 *
 * ## Examples by Block Kind
 *
 * ```java
 * // === Exception Handling ===
 *
 * // TRY
 * try {
 *     riskyOperation();
 * }
 *
 * // TRY_WITH_RESOURCES (Java 7+)
 * try (FileReader reader = new FileReader("file.txt")) {
 *     reader.read();
 * }
 *
 * // CATCH
 * try { ... } catch (IOException e) {
 *     handleError(e);
 * }
 *
 * // FINALLY
 * try { ... } finally {
 *     cleanup();
 * }
 *
 * // === Loops ===
 *
 * // FOR
 * for (int i = 0; i < 10; i++) {
 *     process(i);
 * }
 *
 * // ENHANCED_FOR (Java 5+)
 * for (String item : items) {
 *     process(item);
 * }
 *
 * // WHILE
 * while (condition) {
 *     doWork();
 * }
 *
 * // DO_WHILE
 * do {
 *     doWork();
 * } while (condition);
 *
 * // === Conditionals ===
 *
 * // IF
 * if (condition) {
 *     handleTrue();
 * }
 *
 * // ELSE_IF (tree-sitter: if_statement in alternative position)
 * if (c1) {
 *     // IF block
 * } else if (c2) {
 *     // ELSE_IF block
 * }
 *
 * // ELSE (tree-sitter: block in alternative position)
 * if (condition) {
 *     // IF block
 * } else {
 *     // ELSE block
 * }
 *
 * // SWITCH_CASE (traditional)
 * switch (value) {
 *     case 1:
 *         handle1();
 *         break;
 *     default:
 *         handleDefault();
 * }
 *
 * // SWITCH_EXPRESSION_CASE (Java 14+)
 * int result = switch (day) {
 *     case MONDAY -> 1;
 *     case TUESDAY -> 2;
 *     default -> 0;
 * };
 *
 * // === Synchronization ===
 *
 * // SYNCHRONIZED
 * synchronized (lock) {
 *     sharedResource.update();
 * }
 * ```
 *
 * ## Ownership Model
 *
 * Blocks form a hierarchy where each block can contain:
 * - Local variables (linked via parentExpressionLinkHash)
 * - Expression statements (linked via expressionOwnerHash)
 * - Nested blocks (linked via parentContainerHash)
 *
 * ## Example Hierarchy
 *
 * ```java
 * void process() {
 *     try {                                    // TRY block
 *         for (int i = 0; i < 10; i++) {       // FOR block (parent: TRY)
 *             if (condition) {                  // IF block (parent: FOR)
 *                 doSomething();                // owned by IF block
 *             }
 *         }
 *     } catch (Exception e) {                  // CATCH block (tryStatementHash links to TRY)
 *         handleError(e);                      // owned by CATCH block
 *     } finally {                              // FINALLY block (tryStatementHash links to TRY)
 *         cleanup();                           // owned by FINALLY block
 *     }
 * }
 * ```
 *
 * ## Key Fields in BlockRegistry
 *
 * - `parentContainerHash` – Links to containing block or lambda expression
 * - `tryStatementHash` – Groups TRY + CATCH + FINALLY blocks together
 * - `methodOwnerHash` – Always points to the containing method
 */
export enum BlockKind {
  // === Exception Handling ===
  /** Standard try block body. */
  TRY = 'TRY',

  /** Try-with-resources block (Java 7+). Resources are auto-closed. */
  TRY_WITH_RESOURCES = 'TRY_WITH_RESOURCES',

  /** Catch clause block. Contains exception handling code. */
  CATCH = 'CATCH',

  /** Finally clause block. Always executes after try/catch. */
  FINALLY = 'FINALLY',

  // === Loops ===
  /** Standard for loop block. */
  FOR = 'FOR',

  /** Enhanced for loop / for-each block (Java 5+). */
  ENHANCED_FOR = 'ENHANCED_FOR',

  /** While loop block. */
  WHILE = 'WHILE',

  /** Do-while loop block. */
  DO_WHILE = 'DO_WHILE',

  // === Conditionals ===
  /** If statement block (the "then" branch). */
  IF = 'IF',

  /**
   * Else-if block. In Java, `else if` is syntactically an else containing an if,
   * but tree-sitter represents it as an if_statement directly in the alternative.
   * 
   * ```java
   * if (c1) {
   *     // IF block
   * } else if (c2) {
   *     // ELSE_IF block (not ELSE + nested IF)
   * } else {
   *     // ELSE block
   * }
   * ```
   */
  ELSE_IF = 'ELSE_IF',

  /** Standalone else block (when alternative is a block, not another if_statement). */
  ELSE = 'ELSE',

  /** Switch case block (traditional or arrow). */
  SWITCH_CASE = 'SWITCH_CASE',

  /** Switch expression case (Java 14+). */
  SWITCH_EXPRESSION_CASE = 'SWITCH_EXPRESSION_CASE',

  // === Synchronization ===
  /** Synchronized block. */
  SYNCHRONIZED = 'SYNCHRONIZED',
}
