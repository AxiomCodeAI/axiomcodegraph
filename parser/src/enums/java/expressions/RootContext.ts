/**
 * Identifies where an expression tree is rooted in the source code.
 *
 * This enumeration describes the attachment point for the entire expression tree,
 * not the relationship between parent-child expressions (that's EdgeRole).
 *
 * ## Context Categories
 *
 * - **Declarations** – Field initializers, local variables
 * - **Statements** – Return, throw, assert
 * - **Control Flow** – If, while, for, switch conditions
 * - **Exception Handling** – Try, catch, finally blocks
 * - **Blocks** – Static/instance initializers
 *
 * ## Classification Examples
 *
 * ```java
 * public class Example {
 *     // FIELD_INITIALIZER - expression initializes a field
 *     private int count = 42;                    // rootContext: FIELD_INITIALIZER
 *     private String name = getName();           // rootContext: FIELD_INITIALIZER
 *     private List<String> items = new ArrayList<>();  // rootContext: FIELD_INITIALIZER
 *
 *     // STATIC_INITIALIZER - expression in static block
 *     static {
 *         DEFAULT_VALUE = computeDefault();      // rootContext: STATIC_INITIALIZER
 *     }
 *
 *     // INSTANCE_INITIALIZER - expression in instance block
 *     {
 *         instanceId = generateId();             // rootContext: INSTANCE_INITIALIZER
 *     }
 *
 *     public void method() {
 *         // LOCAL_VAR_INITIALIZER - expression initializes local variable
 *         int x = a + b;                         // rootContext: LOCAL_VAR_INITIALIZER
 *
 *         // RETURN_VALUE - expression in return statement
 *         return x * 2;                          // rootContext: RETURN_VALUE
 *
 *         // THROW_VALUE - expression in throw statement
 *         throw new RuntimeException("error");   // rootContext: THROW_VALUE
 *
 *         // IF_CONDITION - expression in if condition
 *         if (x > 0) { }                         // rootContext: IF_CONDITION
 *
 *         // WHILE_CONDITION - expression in while condition
 *         while (running) { }                    // rootContext: WHILE_CONDITION
 *
 *         // FOR_INIT/CONDITION/UPDATE - expressions in for loop
 *         for (int i = 0; i < 10; i++) { }       // three different contexts
 *
 *         // DO_WHILE_CONDITION - expression in do-while condition
 *         do {
 *             process();
 *         } while (hasMore());                    // rootContext: DO_WHILE_CONDITION
 *
 *         // ASSERT_CONDITION / ASSERT_MESSAGE - expressions in assert statement
 *         assert x > 0;                           // rootContext: ASSERT_CONDITION
 *         assert x > 0 : "x must be positive";   // condition: ASSERT_CONDITION, message: ASSERT_MESSAGE
 *
 *         // EXPRESSION_STATEMENT - standalone expression as statement
 *         doSomething();                          // rootContext: EXPRESSION_STATEMENT
 *         counter++;                              // rootContext: EXPRESSION_STATEMENT
 *         list.add(item);                         // rootContext: EXPRESSION_STATEMENT
 *
 *         // SYNCHRONIZED_LOCK - expression in synchronized block
 *         synchronized (lock) {                   // rootContext: SYNCHRONIZED_LOCK
 *             sharedResource.update();
 *         }
 *     }
 *
 *     // EXPLICIT_CONSTRUCTOR_INVOCATION - this() or super() in constructor
 *     public MyClass() {
 *         super(compute());                       // rootContext: EXPLICIT_CONSTRUCTOR_INVOCATION
 *     }
 *
 *     public MyClass(int x) {
 *         this();                                 // rootContext: EXPLICIT_CONSTRUCTOR_INVOCATION
 *
 *         // ENHANCED_FOR_ITERABLE - iterable in enhanced for
 *         for (String s : items) { }             // rootContext: ENHANCED_FOR_ITERABLE
 *
 *         // SWITCH_SELECTOR - expression being switched on
 *         switch (status) {                       // rootContext: SWITCH_SELECTOR
 *             // SWITCH_CASE_LABEL - case label constants in statement switch
 *             case ACTIVE:                        // rootContext: SWITCH_CASE_LABEL
 *             case PENDING:                       // rootContext: SWITCH_CASE_LABEL
 *                 handleActive();
 *                 break;                          // rootContext: BREAK_STATEMENT
 *             default:                            // rootContext: SWITCH_CASE_LABEL (synthetic "default")
 *                 handleOther();
 *         }
 *
 *         // BREAK_STATEMENT - break; or break label; in switch case or loop
 *         for (int i = 0; i < 10; i++) {
 *             if (found) break outer;             // rootContext: BREAK_STATEMENT (literalValue = "outer")
 *         }
 *
 *         // CONTINUE_STATEMENT - continue; or continue label; in a loop
 *         for (String s : items) {
 *             if (s == null) continue;            // rootContext: CONTINUE_STATEMENT
 *             if (skip) continue outer;           // rootContext: CONTINUE_STATEMENT (literalValue = "outer")
 *         }
 *
 *         // YIELD_VALUE - expression in yield statement (switch expression)
 *         String label = switch (status) {
 *             case ACTIVE -> "active";
 *             default -> {
 *                 String s = compute();
 *                 yield s.toUpperCase();           // rootContext: YIELD_VALUE
 *             }
 *         };
 *
 *         // TRY_RESOURCE - resource expression in try-with-resources
 *         try (var r = getResource()) {          // getResource(): rootContext: TRY_RESOURCE
 *             // TRY_BLOCK - expression in try block body
 *             process(r);                        // rootContext: TRY_BLOCK
 *         } catch (Exception e) {
 *             // CATCH_BLOCK - expression in catch block body
 *             log(e);                            // rootContext: CATCH_BLOCK
 *         } finally {
 *             // FINALLY_BLOCK - expression in finally block body
 *             cleanup();                         // rootContext: FINALLY_BLOCK
 *         }
 *
 *         // Regular try (no resources) - only has TRY_BLOCK, CATCH_BLOCK, FINALLY_BLOCK
 *         try {
 *             riskyOperation();                  // rootContext: TRY_BLOCK
 *         } catch (Exception e) {
 *             handleError(e);                    // rootContext: CATCH_BLOCK
 *         }
 *     }
 * }
 *
 * // ANNOTATION_VALUE - expression in annotation argument
 * @MyAnnotation(value = 42)                      // rootContext: ANNOTATION_VALUE
 * public class Annotated { }
 *
 * // ANNOTATION_DEFAULT - default value in annotation method
 * @interface Config {
 *     int timeout() default 30;                  // rootContext: ANNOTATION_DEFAULT
 *     String name() default "default";           // rootContext: ANNOTATION_DEFAULT
 * }
 *
 * // ENUM_CONSTANT_ARGUMENT - expression in enum constant constructor argument
 * enum Status {
 *     ACTIVE(1, "Active"),                       // 1 and "Active": rootContext: ENUM_CONSTANT_ARGUMENT
 *     INACTIVE(0, "Inactive"),                   // 0 and "Inactive": rootContext: ENUM_CONSTANT_ARGUMENT
 *     PENDING(computeCode(), "Pending");         // computeCode() and "Pending": rootContext: ENUM_CONSTANT_ARGUMENT
 *
 *     Status(int code, String label) { ... }
 * }
 *
 * enum ComplexEnum {
 *     VALUE(new ArrayList<>(), true ? "yes" : "no");  // new ArrayList<>() and ternary: rootContext: ENUM_CONSTANT_ARGUMENT
 * }
 * ```
 *
 * ## Key Invariant
 *
 * - **Root expressions** have a meaningful rootContext
 * - **Child expressions** inherit rootContext from their root ancestor
 * - All expressions in a tree share the same rootContext
 */
export enum RootContext {
  // === Declarations ===
  /** Expression initializes a field (private int x = EXPR). */
  FIELD_INITIALIZER = 'FIELD_INITIALIZER',

  /** Expression initializes a local variable. */
  LOCAL_VAR_INITIALIZER = 'LOCAL_VAR_INITIALIZER',

  /** Expression in return statement. */
  RETURN_VALUE = 'RETURN_VALUE',

  /** Expression in throw statement. */
  THROW_VALUE = 'THROW_VALUE',

  /** Expression in assert condition. */
  ASSERT_CONDITION = 'ASSERT_CONDITION',

  /** Expression in assert message. */
  ASSERT_MESSAGE = 'ASSERT_MESSAGE',

  /** Expression in if/else-if condition. */
  IF_CONDITION = 'IF_CONDITION',

  /** Expression in while loop condition. */
  WHILE_CONDITION = 'WHILE_CONDITION',

  /** Expression in do-while condition. */
  DO_WHILE_CONDITION = 'DO_WHILE_CONDITION',

  /** Expression in for loop initialization. */
  FOR_INIT = 'FOR_INIT',

  /** Expression in for loop condition. */
  FOR_CONDITION = 'FOR_CONDITION',

  /** Expression in for loop update. */
  FOR_UPDATE = 'FOR_UPDATE',

  /** Iterable expression in enhanced for loop. */
  ENHANCED_FOR_ITERABLE = 'ENHANCED_FOR_ITERABLE',

  /** Expression being switched on. */
  SWITCH_SELECTOR = 'SWITCH_SELECTOR',

  /** Case label constant in a statement switch (case 1, 9: or case "hello" ->). */
  SWITCH_CASE_LABEL = 'SWITCH_CASE_LABEL',

  /** Expression in synchronized block. */
  SYNCHRONIZED_LOCK = 'SYNCHRONIZED_LOCK',

  /** Resource expression in try-with-resources. */
  TRY_RESOURCE = 'TRY_RESOURCE',

  /** Expression in try block body. */
  TRY_BLOCK = 'TRY_BLOCK',

  /** Expression in catch block body. */
  CATCH_BLOCK = 'CATCH_BLOCK',

  /** Expression in finally block body. */
  FINALLY_BLOCK = 'FINALLY_BLOCK',

  /** Expression in annotation argument. */
  ANNOTATION_VALUE = 'ANNOTATION_VALUE',

  /** Expression in static initializer block. */
  STATIC_INITIALIZER = 'STATIC_INITIALIZER',

  /** Expression in instance initializer block. */
  INSTANCE_INITIALIZER = 'INSTANCE_INITIALIZER',

  /** Expression in yield statement (switch expression). */
  YIELD_VALUE = 'YIELD_VALUE',

  /** Standalone expression as statement (method call, assignment). */
  EXPRESSION_STATEMENT = 'EXPRESSION_STATEMENT',

  /** Expression in explicit constructor invocation (this(), super()). */
  EXPLICIT_CONSTRUCTOR_INVOCATION = 'EXPLICIT_CONSTRUCTOR_INVOCATION',

  /** Default value expression in annotation method declaration. */
  ANNOTATION_DEFAULT = 'ANNOTATION_DEFAULT',

  /** Expression in enum constant argument. */
  ENUM_CONSTANT_ARGUMENT = 'ENUM_CONSTANT_ARGUMENT',

  /** Break statement (break; or break label;) in switch case or loop. */
  BREAK_STATEMENT = 'BREAK_STATEMENT',

  /** Continue statement (continue; or continue label;) in a loop. */
  CONTINUE_STATEMENT = 'CONTINUE_STATEMENT',
}
