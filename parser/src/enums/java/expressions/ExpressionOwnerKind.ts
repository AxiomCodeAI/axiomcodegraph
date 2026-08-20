/**
 * Identifies the type of syntactic construct that owns an expression tree.
 *
 * This enumeration describes the actual owning entity of an expression,
 * not the relationship between expressions (that's EdgeRole).
 *
 * ## Owner Categories
 *
 * - **Declarations** – Field, local variable
 * - **Statements** – Return, throw, assert, expression statement
 * - **Control Flow** – If, while, for, switch, etc.
 * - **Blocks** – Static/instance initializer blocks
 * - **Other** – Annotation argument, enum constant argument
 *
 * ## Classification Examples
 *
 * ```java
 * public class Example {
 *     // FIELD - expression owned by field declaration
 *     private int count = 42;                    // ownerKind: FIELD
 *     private String name = getName();           // ownerKind: FIELD
 *
 *     // STATIC_INIT_BLOCK - expression in static block
 *     static {
 *         DEFAULT = compute();                   // ownerKind: STATIC_INIT_BLOCK
 *     }
 *
 *     // INSTANCE_INIT_BLOCK - expression in instance block
 *     {
 *         instanceId = generate();               // ownerKind: INSTANCE_INIT_BLOCK
 *     }
 *
 *     public void method() {
 *         // LOCAL_VARIABLE - expression owned by local var declaration
 *         int x = a + b;                         // ownerKind: LOCAL_VARIABLE
 *
 *         // RETURN_STATEMENT - expression in return
 *         return x * 2;                          // ownerKind: RETURN_STATEMENT
 *
 *         // THROW_STATEMENT - expression in throw
 *         throw new RuntimeException();          // ownerKind: THROW_STATEMENT
 *
 *         // BREAK_STATEMENT - break in switch case or loop
 *         switch (x) {
 *             case 1:
 *                 doSomething();
 *                 break;                         // ownerKind: BREAK_STATEMENT
 *         }
 *         for (int i = 0; i < 10; i++) {
 *             if (i == 5) break outer;           // ownerKind: BREAK_STATEMENT
 *         }
 *
 *         // CONTINUE_STATEMENT - continue in a loop
 *         for (String s : items) {
 *             if (s == null) continue;           // ownerKind: CONTINUE_STATEMENT
 *             if (skip) continue outer;          // ownerKind: CONTINUE_STATEMENT
 *         }
 *
 *         // ASSERT_STATEMENT - expression in assert
 *         assert x > 0 : "must be positive";     // ownerKind: ASSERT_STATEMENT
 *
 *         // EXPRESSION_STATEMENT - standalone expression
 *         System.out.println("hello");           // ownerKind: EXPRESSION_STATEMENT
 *
 *         // IF_STATEMENT - condition expression
 *         if (isValid) { }                       // ownerKind: IF_STATEMENT
 *
 *         // WHILE_STATEMENT - condition expression
 *         while (running) { }                    // ownerKind: WHILE_STATEMENT
 *
 *         // DO_WHILE_STATEMENT - condition expression
 *         do {
 *             process();
 *         } while (hasMore());                    // ownerKind: DO_WHILE_STATEMENT
 *
 *         // FOR_STATEMENT - init/condition/update expressions
 *         for (int i = 0; i < 10; i++) { }       // ownerKind: FOR_STATEMENT
 *
 *         // ENHANCED_FOR_STATEMENT - iterable expression
 *         for (String s : items) { }             // ownerKind: ENHANCED_FOR_STATEMENT
 *
 *         // SWITCH_STATEMENT - selector expression
 *         switch (status) { }                    // ownerKind: SWITCH_STATEMENT
 *
 *         // SWITCH_EXPRESSION - switch as expression
 *         String s = switch(x) { ... };          // ownerKind: SWITCH_EXPRESSION
 *
 *         // SYNCHRONIZED_STATEMENT - lock expression
 *         synchronized (lock) { }                // ownerKind: SYNCHRONIZED_STATEMENT
 *
 *         // TRY_STATEMENT - resource expression in try-with-resources
 *         try (var r = getResource()) {          // getResource(): ownerKind: TRY_STATEMENT
 *             // TRY_BLOCK - expression in try block body
 *             process(r);                        // ownerKind: TRY_BLOCK
 *         } catch (Exception e) {
 *             // CATCH_BLOCK - expression in catch block body
 *             log(e);                            // ownerKind: CATCH_BLOCK
 *         } finally {
 *             // FINALLY_BLOCK - expression in finally block body
 *             cleanup();                         // ownerKind: FINALLY_BLOCK
 *         }
 *
 *         // Regular try (no resources) - only has TRY_BLOCK, CATCH_BLOCK, FINALLY_BLOCK
 *         try {
 *             riskyOperation();                  // ownerKind: TRY_BLOCK
 *         } catch (Exception e) {
 *             handleError(e);                    // ownerKind: CATCH_BLOCK
 *         }
 *     }
 * }
 *
 * // ANNOTATION_ARGUMENT - expression in annotation
 * @MyAnnotation(value = 42)                      // ownerKind: ANNOTATION_ARGUMENT
 * class Annotated { }
 *
 * // ENUM_CONSTANT_ARGUMENT - expression in enum constant
 * enum Status {
 *     ACTIVE(1, "Active");                       // ownerKind: ENUM_CONSTANT_ARGUMENT
 * }
 *
 * // RECORD_COMPONENT - expression in record component (Java 16+)
 * record Config(
 *     int timeout,                               // No initializer, no expression
 *     String name
 * ) { }
 * // Note: Record components with default values or compact constructor
 * // assignments may produce expressions with ownerKind: RECORD_COMPONENT
 * ```
 *
 * ## Key Invariants
 *
 * - All expressions in a tree share the same ownerKind and ownerHash
 * - ownerHash links to the actual entity (FieldRegistry hash, etc.)
 */
export enum ExpressionOwnerKind {
  // === Declarations ===
  /** Expression owned by field declaration. */
  FIELD = 'FIELD',

  /** Expression owned by local variable declaration. */
  LOCAL_VARIABLE = 'LOCAL_VARIABLE',

  // === Statements ===
  /** Expression in return statement. */
  RETURN_STATEMENT = 'RETURN_STATEMENT',

  /** Expression in throw statement. */
  THROW_STATEMENT = 'THROW_STATEMENT',

  /** Break statement in a switch case or loop. */
  BREAK_STATEMENT = 'BREAK_STATEMENT',

  /** Continue statement in a loop. */
  CONTINUE_STATEMENT = 'CONTINUE_STATEMENT',

  /** Expression in assert statement. */
  ASSERT_STATEMENT = 'ASSERT_STATEMENT',

  /** Standalone expression as statement (e.g., method call). */
  EXPRESSION_STATEMENT = 'EXPRESSION_STATEMENT',

  // === Control Flow ===
  /** Expression in if statement condition. */
  IF_STATEMENT = 'IF_STATEMENT',

  /** Expression in while loop. */
  WHILE_STATEMENT = 'WHILE_STATEMENT',

  /** Expression in do-while loop. */
  DO_WHILE_STATEMENT = 'DO_WHILE_STATEMENT',

  /** Expression in for loop (init, condition, or update). */
  FOR_STATEMENT = 'FOR_STATEMENT',

  /** Expression in enhanced for loop (iterable). */
  ENHANCED_FOR_STATEMENT = 'ENHANCED_FOR_STATEMENT',

  /** Expression in switch statement selector. */
  SWITCH_STATEMENT = 'SWITCH_STATEMENT',

  /** Expression in switch expression (Java 14+). */
  SWITCH_EXPRESSION = 'SWITCH_EXPRESSION',

  /** Expression in synchronized statement lock. */
  SYNCHRONIZED_STATEMENT = 'SYNCHRONIZED_STATEMENT',

  /** Expression in try-with-resources. */
  TRY_STATEMENT = 'TRY_STATEMENT',

  /** Expression in try block body. */
  TRY_BLOCK = 'TRY_BLOCK',

  /** Expression in catch block body. */
  CATCH_BLOCK = 'CATCH_BLOCK',

  /** Expression in finally block body. */
  FINALLY_BLOCK = 'FINALLY_BLOCK',

  // === Blocks ===
  /** Expression in static initializer block. */
  STATIC_INIT_BLOCK = 'STATIC_INIT_BLOCK',

  /** Expression in instance initializer block. */
  INSTANCE_INIT_BLOCK = 'INSTANCE_INIT_BLOCK',

  // === Other ===
  /** Expression in annotation argument. */
  ANNOTATION_ARGUMENT = 'ANNOTATION_ARGUMENT',

  /** Expression in enum constant argument. */
  ENUM_CONSTANT_ARGUMENT = 'ENUM_CONSTANT_ARGUMENT',

  /** Expression in record component (Java 16+). */
  RECORD_COMPONENT = 'RECORD_COMPONENT',
}
