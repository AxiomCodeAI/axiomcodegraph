/**
 * Identifies the syntactic scope where a local variable is declared.
 *
 * This enumeration classifies the declaration context of local variables,
 * which is essential for:
 * - Scope analysis and variable resolution
 * - Understanding variable lifetime
 * - Linking variables to their enclosing construct
 *
 * ## Scope Categories
 *
 * - **Method Scopes** – Variables in regular methods, constructors
 * - **Lambda Scopes** – Variables inside lambda expressions (can be nested)
 * - **Block Scopes** – Variables in initializer blocks
 * - **Loop Scopes** – Variables in for/enhanced-for loop declarations
 * - **Exception Scopes** – Variables in try-with-resources, catch clauses
 * - **Special Scopes** – Anonymous class methods, record methods, enum methods
 *
 * ## Classification Examples
 *
 * ```java
 * public class Example {
 *     // STATIC_INITIALIZER - in static block
 *     static {
 *         int staticBlockVar = 10;  // scopeKind: STATIC_INITIALIZER
 *     }
 *
 *     // INSTANCE_INITIALIZER - in instance block
 *     {
 *         int instanceBlockVar = 20;  // scopeKind: INSTANCE_INITIALIZER
 *     }
 *
 *     // CONSTRUCTOR_BODY - in constructor
 *     public Example() {
 *         int constructorVar = 30;  // scopeKind: CONSTRUCTOR_BODY
 *     }
 *
 *     public void method() {
 *         // METHOD_BODY - regular method
 *         int methodVar = 40;  // scopeKind: METHOD_BODY
 *
 *         // LAMBDA_BODY - inside lambda
 *         Supplier<Integer> s = () -> {
 *             int lambdaVar = 50;  // scopeKind: LAMBDA_BODY, scopeDepth: 1
 *
 *             // Nested lambda
 *             return (() -> {
 *                 int nestedLambdaVar = 60;  // scopeKind: LAMBDA_BODY, scopeDepth: 2
 *                 return nestedLambdaVar;
 *             }).get();
 *         };
 *
 *         // FOR_LOOP - in for loop declaration
 *         for (int i = 0; i < 10; i++) {  // i: scopeKind: FOR_LOOP
 *             int loopBodyVar = 70;  // scopeKind: FOR_BLOCK
 *         }
 *
 *         // ENHANCED_FOR_LOOP - in enhanced for loop
 *         for (String item : items) {  // item: scopeKind: ENHANCED_FOR_LOOP
 *             int eachVar = 80;  // scopeKind: FOR_BLOCK
 *         }
 *
 *         // TRY_WITH_RESOURCES - resource variable
 *         try (var reader = new BufferedReader(...)) {  // reader: scopeKind: TRY_WITH_RESOURCES
 *             int tryVar = 90;  // scopeKind: TRY_BLOCK (inside try body)
 *         } catch (IOException e) {  // e: scopeKind: CATCH_CLAUSE
 *             int catchVar = 100;  // scopeKind: CATCH_BLOCK (inside catch body)
 *         } finally {
 *             int finallyVar = 101;  // scopeKind: FINALLY_BLOCK (inside finally body)
 *         }
 *
 *         // === Control Flow Block Scopes ===
 *
 *         // FOR_BLOCK - variable inside for loop body
 *         for (int i = 0; i < 10; i++) {  // i: scopeKind: FOR_LOOP
 *             int loopBodyVar = 70;  // scopeKind: FOR_BLOCK
 *         }
 *
 *         // WHILE_BLOCK - variable inside while loop body
 *         while (running) {
 *             int whileVar = 71;  // scopeKind: WHILE_BLOCK
 *         }
 *
 *         // DO_WHILE_BLOCK - variable inside do-while loop body
 *         do {
 *             int doWhileVar = 72;  // scopeKind: DO_WHILE_BLOCK
 *         } while (hasMore());
 *
 *         // IF_BLOCK / ELSE_IF_BLOCK / ELSE_BLOCK
 *         if (condition) {
 *             int ifVar = 73;  // scopeKind: IF_BLOCK
 *         } else if (other) {
 *             int elseIfVar = 74;  // scopeKind: ELSE_IF_BLOCK
 *         } else {
 *             int elseVar = 75;  // scopeKind: ELSE_BLOCK
 *         }
 *
 *         // SWITCH_BLOCK - variable inside switch case
 *         switch (status) {
 *             case ACTIVE:
 *                 int switchVar = 76;  // scopeKind: SWITCH_BLOCK
 *                 break;
 *         }
 *
 *         // SYNCHRONIZED_BLOCK - variable inside synchronized block
 *         synchronized (lock) {
 *             int syncVar = 77;  // scopeKind: SYNCHRONIZED_BLOCK
 *         }
 *     }
 *
 *     // ANONYMOUS_CLASS_METHOD - in anonymous class method
 *     Runnable r = new Runnable() {
 *         public void run() {
 *             int anonMethodVar = 110;  // scopeKind: ANONYMOUS_CLASS_METHOD
 *         }
 *     };
 * }
 *
 * // RECORD_METHOD - in record method
 * record Point(int x, int y) {
 *     public double distance() {
 *         double dx = x;  // scopeKind: RECORD_METHOD
 *         return dx;
 *     }
 * }
 *
 * // ENUM_METHOD - in enum constant anonymous body or enum method
 * enum Status {
 *     ACTIVE {
 *         public String describe() {
 *             String desc = "Active";  // scopeKind: ENUM_CONSTANT_METHOD
 *             return desc;
 *         }
 *     };
 *     public String describe() {
 *         String base = "Status";  // scopeKind: ENUM_METHOD
 *         return base;
 *     }
 * }
 *
 * // === Pattern Scopes (Java 16+) ===
 *
 * // INSTANCEOF_PATTERN - pattern binding in instanceof
 * if (obj instanceof String s) {              // s: scopeKind: INSTANCEOF_PATTERN
 *     System.out.println(s.toUpperCase());
 * }
 *
 * // SWITCH_PATTERN - pattern binding in switch case
 * switch (obj) {
 *     case String s when s.length() > 5:      // s: scopeKind: SWITCH_PATTERN
 *         System.out.println(s);
 *         break;
 *     default:
 *         break;
 * }
 *
 * // RECORD_PATTERN - pattern binding in record deconstruction (Java 21+)
 * if (obj instanceof Person(String name, int age)) {  // name, age: scopeKind: RECORD_PATTERN
 *     System.out.println(name + " is " + age);
 * }
 * ```
 *
 * ## Scope Depth
 *
 * For nested lambdas, `scopeDepth` indicates nesting level:
 * - 0 = method body (not in a lambda)
 * - 1 = first lambda level
 * - 2 = nested lambda inside another lambda
 * - etc.
 */
export enum LocalVariableScopeKind {
  // === Method Scopes ===
  /** Variable in regular method body. */
  METHOD_BODY = 'METHOD_BODY',

  /** Variable in constructor body. */
  CONSTRUCTOR_BODY = 'CONSTRUCTOR_BODY',

  // === Lambda Scopes ===
  /** Variable inside lambda expression body. */
  LAMBDA_BODY = 'LAMBDA_BODY',

  // === Block Scopes ===
  /** Variable in static initializer block. */
  STATIC_INITIALIZER = 'STATIC_INITIALIZER',

  /** Variable in instance initializer block. */
  INSTANCE_INITIALIZER = 'INSTANCE_INITIALIZER',

  // === Loop Scopes ===
  /** Variable declared in for loop initialization (int i = 0). */
  FOR_LOOP = 'FOR_LOOP',

  /** Variable declared in enhanced for loop (String item : items). */
  ENHANCED_FOR_LOOP = 'ENHANCED_FOR_LOOP',

  // === Exception Binding Scopes ===
  /** Resource variable in try-with-resources header. */
  TRY_WITH_RESOURCES = 'TRY_WITH_RESOURCES',

  /** Exception variable in catch clause header. */
  CATCH_CLAUSE = 'CATCH_CLAUSE',

  // === Exception Block Body Scopes ===
  /** Variable inside try block body (regular or with-resources). */
  TRY_BLOCK = 'TRY_BLOCK',

  /** Variable inside catch block body. */
  CATCH_BLOCK = 'CATCH_BLOCK',

  /** Variable inside finally block body. */
  FINALLY_BLOCK = 'FINALLY_BLOCK',

  // === Control Flow Block Scopes ===
  /** Variable inside for loop body. */
  FOR_BLOCK = 'FOR_BLOCK',

  /** Variable inside while loop body. */
  WHILE_BLOCK = 'WHILE_BLOCK',

  /** Variable inside do-while loop body. */
  DO_WHILE_BLOCK = 'DO_WHILE_BLOCK',

  /** Variable inside if block body. */
  IF_BLOCK = 'IF_BLOCK',

  /** Variable inside else-if block body. */
  ELSE_IF_BLOCK = 'ELSE_IF_BLOCK',

  /** Variable inside else block body. */
  ELSE_BLOCK = 'ELSE_BLOCK',

  /** Variable inside switch case/default block. */
  SWITCH_BLOCK = 'SWITCH_BLOCK',

  /** Variable inside synchronized block. */
  SYNCHRONIZED_BLOCK = 'SYNCHRONIZED_BLOCK',

  // === Special Method Scopes ===
  /** Variable in anonymous class method body. */
  ANONYMOUS_CLASS_METHOD = 'ANONYMOUS_CLASS_METHOD',

  /** Variable in record class method body. */
  RECORD_METHOD = 'RECORD_METHOD',

  /** Variable in enum class method body. */
  ENUM_METHOD = 'ENUM_METHOD',

  /** Variable in enum constant's anonymous class method. */
  ENUM_CONSTANT_METHOD = 'ENUM_CONSTANT_METHOD',

  // === Pattern Scopes ===
  /** Pattern binding variable in instanceof pattern. */
  INSTANCEOF_PATTERN = 'INSTANCEOF_PATTERN',

  /** Pattern binding variable in switch case pattern. */
  SWITCH_PATTERN = 'SWITCH_PATTERN',

  /** Pattern binding variable in record pattern deconstruction. */
  RECORD_PATTERN = 'RECORD_PATTERN',
}
