/**
 * Identifies the type of block/closure in a Gradle build file.
 *
 * Follows the same pattern as Java's BlockKind — each control flow construct
 * gets its own enum value so blocks can be queried directly and expressions
 * captured. DSL-specific blocks that don't have distinct field semantics
 * use `DSL_BLOCK` with the identity in the `blockName` field.
 *
 * ## Block Categories
 *
 * - **Gradle DSL** – buildscript, plugins, dependencies, repositories, etc.
 * - **Scope Modifiers** – allprojects, subprojects
 * - **Exception Handling** – try, catch, finally
 * - **Loops** – for, for-each/for-in, while, do-while
 * - **Conditionals** – if, else-if, else, switch/case, when (Kotlin)
 * - **DSL Catch-all** – any other named block (including .each { }, .forEach { }, closures)
 *
 * ## Examples
 *
 * ```groovy
 * // === Gradle DSL Blocks ===
 *
 * // BUILDSCRIPT
 * buildscript { repositories { } dependencies { } }
 *
 * // PLUGINS
 * plugins { id 'java' }
 *
 * // DEPENDENCIES
 * dependencies { implementation 'com.google.guava:guava:32.1.3-jre' }
 *
 * // DSL_BLOCK (blockName = "maven")
 * repositories { maven { url 'https://...' } }
 *
 * // === Control Flow ===
 *
 * // IF (expression = "project.hasProperty('ci')")
 * if (project.hasProperty('ci')) { ... }
 *
 * // FOR (expression = "int i = 0; i < 10; i++")
 * for (int i = 0; i < 10; i++) { ... }
 *
 * // FOR_EACH (expression = "dep in configurations.implementation")
 * for (dep in configurations.implementation) { ... }
 *
 * // WHILE (expression = "retryCount > 0")
 * while (retryCount > 0) { ... }
 *
 * // TRY
 * try { riskyOperation() } catch (Exception e) { handleError(e) }
 *
 * // SWITCH_CASE (Groovy)
 * switch (env) { case 'prod': ... }
 *
 * // WHEN (Kotlin)
 * when (env) { "prod" -> ... }
 *
 * // DSL_BLOCK (blockName = "each") — closures handled same as DSL blocks
 * configurations.each { ... }
 * ```
 *
 * ## Ownership Model
 *
 * Blocks form a tree via `parentBlockHash`. Each block can contain:
 * - Child blocks (nested control flow, DSL sub-blocks)
 * - Declarations (linked via parentBlockHash)
 * - Value references (linked via ownerBlockHash)
 *
 * ## Example Hierarchy
 *
 * ```groovy
 * dependencies {                           // DEPENDENCIES block
 *     if (project.hasProperty('ci')) {     //   IF block (parent: DEPENDENCIES)
 *         for (dep in ciDeps) {            //     FOR_EACH block (parent: IF)
 *             implementation dep           //       DEPENDENCY decl (parent: FOR_EACH)
 *         }
 *     } else {                            //   ELSE block (parent: IF)
 *         implementation 'com.x:y:1.0'    //     DEPENDENCY decl (parent: ELSE)
 *     }
 * }
 * ```
 */
export enum GradleBlockType {
  // === Gradle DSL Blocks ===
  /** buildscript { } */
  BUILDSCRIPT = 'BUILDSCRIPT',

  /** plugins { } — children use special id/version syntax */
  PLUGINS = 'PLUGINS',

  /** dependencies { } — children are dependency declarations */
  DEPENDENCIES = 'DEPENDENCIES',

  /** repositories { } — children are repository declarations */
  REPOSITORIES = 'REPOSITORIES',

  /** configurations { } — children are configuration declarations */
  CONFIGURATIONS = 'CONFIGURATIONS',

  /** ext { } / extra { } — children are property definitions */
  EXT = 'EXT',

  // === Scope Modifiers ===
  /** allprojects { } — scope modifier */
  ALLPROJECTS = 'ALLPROJECTS',

  /** subprojects { } — scope modifier */
  SUBPROJECTS = 'SUBPROJECTS',

  // === Tasks ===
  /** Task definition or configuration block (blockName = task name) */
  TASK = 'TASK',

  // === Exception Handling ===
  /** try { } block body */
  TRY = 'TRY',

  /** catch (ExceptionType e) { } block */
  CATCH = 'CATCH',

  /** finally { } block */
  FINALLY = 'FINALLY',

  // === Loops ===
  /** Traditional for loop: for (int i = 0; i < 10; i++) { } */
  FOR = 'FOR',

  /**
   * For-each / for-in loop.
   * Groovy: for (item in list) { } or for (String item : list) { }
   * Kotlin: for (item in list) { }
   */
  FOR_EACH = 'FOR_EACH',

  /** while (condition) { } */
  WHILE = 'WHILE',

  /** do { } while (condition) */
  DO_WHILE = 'DO_WHILE',

  // === Conditionals ===
  /** if (condition) { } — the "then" branch */
  IF = 'IF',

  /**
   * else if (condition) { } — chained conditional.
   * In Groovy, `else if` is syntactically an else containing an if.
   * We flatten it to ELSE_IF for consistency with Java's BlockKind.
   */
  ELSE_IF = 'ELSE_IF',

  /** else { } — standalone else block */
  ELSE = 'ELSE',

  /** switch (x) { } — the enclosing switch statement (expression = selector) */
  SWITCH = 'SWITCH',

  /** Individual case within a switch: case 'a': ... (blockName = case label) */
  SWITCH_CASE = 'SWITCH_CASE',

  /** Kotlin when expression: when (x) { "a" -> ... } */
  WHEN = 'WHEN',

  // === Synchronization ===
  /** synchronized (lock) { } */
  SYNCHRONIZED = 'SYNCHRONIZED',

  // === DSL Catch-all ===
  /**
   * Any other named block. blockName carries the identity:
   * maven, credentials, pom, java, application, constraints,
   * resolutionStrategy, publishing, sourceSets, signing,
   * pluginManagement, afterEvaluate, initscript, testLogging,
   * manifest, exclusiveContent, dependencySubstitution,
   * each, forEach, collect, closures/lambdas, etc.
   */
  DSL_BLOCK = 'DSL_BLOCK',
}
