/**
 * Identifies the type of scope in the AST hierarchy for tracking context.
 *
 * This enumeration classifies the different scope boundaries that affect
 * how variables and expressions are linked to their parent containers.
 *
 * ## Scope Hierarchy
 *
 * Scopes form a hierarchy where:
 * - Methods/constructors are the top-level scope for code
 * - Lambdas create new scope boundaries (reset block context)
 * - Blocks (try/catch/if/for) create nested scopes within methods/lambdas
 * - Static/instance initializers are type-level scopes
 *
 * ## Key Concept: Scope Boundary
 *
 * A **scope boundary** (like LAMBDA) resets the block context. This means
 * variables inside a lambda link to the lambda, not to an outer try/catch block.
 *
 * ## Examples
 *
 * ```java
 * public class Example {
 *     // STATIC_INITIALIZER scope
 *     static {
 *         int x = 10;  // Links to static initializer
 *     }
 *
 *     // INSTANCE_INITIALIZER scope
 *     {
 *         int y = 20;  // Links to instance initializer
 *     }
 *
 *     // METHOD scope
 *     public void process() {
 *         int a = 1;  // Links to method
 *
 *         // BLOCK scope (try)
 *         try {
 *             int b = 2;  // Links to try block
 *
 *             // LAMBDA scope - creates new boundary
 *             Supplier<Integer> s = () -> {
 *                 int c = 3;  // Links to lambda (NOT try block!)
 *
 *                 // BLOCK scope (nested try inside lambda)
 *                 try {
 *                     int d = 4;  // Links to nested try block
 *                 } catch (Exception e) {
 *                     // BLOCK scope (catch)
 *                     int f = 5;  // Links to catch block
 *                 }
 *
 *                 return c;
 *             };
 *
 *         } catch (Exception ex) {
 *             // BLOCK scope (catch)
 *             int g = 6;  // Links to catch block
 *
 *             // LAMBDA scope - creates new boundary
 *             Runnable r = () -> {
 *                 int h = 7;  // Links to lambda (NOT catch block!)
 *             };
 *         }
 *     }
 * }
 * ```
 *
 * ## Scope Stack Example
 *
 * For the variable `d` in the example above, the scope stack would be:
 * ```
 * [0] METHOD (process)
 * [1] BLOCK (try)
 * [2] LAMBDA (supplier)
 * [3] BLOCK (nested try)  <-- d links here
 * ```
 *
 * ## Usage with ScopeContext
 *
 * ```typescript
 * const context = new ScopeContext();
 * context.enterMethod(methodHash, LocalVariableScopeKind.METHOD_BODY);
 * context.enterBlock(tryBlockHash, BlockKind.TRY, LocalVariableScopeKind.TRY_BLOCK);
 * context.enterLambda(lambdaHash);  // Resets block context!
 * 
 * // Inside lambda:
 * const ownerHash = context.getCurrentOwnerHash();  // Returns lambdaHash
 * ```
 */
export enum ScopeType {
  /**
   * Method or constructor body scope.
   * 
   * This is the top-level scope for executable code. Variables declared
   * directly in a method body link to the method.
   * 
   * ```java
   * public void example() {
   *     int x = 10;  // ScopeType: METHOD
   * }
   * 
   * public Example() {
   *     int y = 20;  // ScopeType: METHOD (constructor)
   * }
   * ```
   */
  METHOD = 'METHOD',

  /**
   * Lambda expression body scope.
   * 
   * Creates a **scope boundary** - resets block context. Variables inside
   * a lambda link to the lambda expression, not to any outer block.
   * 
   * ```java
   * try {
   *     Supplier<Integer> s = () -> {
   *         int x = 10;  // ScopeType: LAMBDA (NOT linked to try block)
   *         return x;
   *     };
   * } catch (Exception e) { }
   * ```
   */
  LAMBDA = 'LAMBDA',

  /**
   * Block construct scope (try, catch, finally, if, for, while, etc.)
   * 
   * Blocks create nested scopes within methods or lambdas. Variables
   * declared in a block link to that block's hash.
   * 
   * ```java
   * try {
   *     int x = 10;  // ScopeType: BLOCK (try)
   * } catch (Exception e) {
   *     int y = 20;  // ScopeType: BLOCK (catch)
   * } finally {
   *     int z = 30;  // ScopeType: BLOCK (finally)
   * }
   * 
   * if (condition) {
   *     int a = 1;   // ScopeType: BLOCK (if)
   * }
   * 
   * for (int i = 0; i < 10; i++) {
   *     int b = 2;   // ScopeType: BLOCK (for)
   * }
   * ```
   */
  BLOCK = 'BLOCK',

  /**
   * Static initializer block scope.
   * 
   * Variables declared in a static initializer block link to the type.
   * 
   * ```java
   * public class Example {
   *     static {
   *         int x = 10;  // ScopeType: STATIC_INITIALIZER
   *         
   *         try {
   *             int y = 20;  // ScopeType: BLOCK (nested in static init)
   *         } catch (Exception e) { }
   *     }
   * }
   * ```
   */
  STATIC_INITIALIZER = 'STATIC_INITIALIZER',

  /**
   * Instance initializer block scope.
   * 
   * Variables declared in an instance initializer block link to the type.
   * 
   * ```java
   * public class Example {
   *     {
   *         int x = 10;  // ScopeType: INSTANCE_INITIALIZER
   *         
   *         Runnable r = () -> {
   *             int y = 20;  // ScopeType: LAMBDA (nested in instance init)
   *         };
   *     }
   * }
   * ```
   */
  INSTANCE_INITIALIZER = 'INSTANCE_INITIALIZER',
}
