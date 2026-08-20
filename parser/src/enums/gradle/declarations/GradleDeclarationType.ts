/**
 * Categorizes declarations/statements within Gradle blocks.
 *
 * Only 8 values — each represents a **primary query target** with distinct
 * field semantics. Everything else is `STATEMENT`; the block hierarchy
 * provides context.
 *
 * ## Examples
 *
 * ```groovy
 * // DEPENDENCY — notation: STRING_NOTATION, qualifier: implementation
 * implementation 'com.google.guava:guava:32.1.3-jre'
 *
 * // PLUGIN — notation: PLUGINS_BLOCK_ID
 * plugins { id 'org.springframework.boot' version '3.1.5' }
 *
 * // REPOSITORY — notation: MAVEN_CENTRAL
 * repositories { mavenCentral() }
 *
 * // PROPERTY — qualifier: EXT_BLOCK
 * ext { guavaVersion = '32.1.3-jre' }
 *
 * // TASK — notation: TASK_KEYWORD
 * task hello { doLast { println 'Hello' } }
 *
 * // CONFIGURATION
 * configurations { smokeTest.extendsFrom testImplementation }
 *
 * // INCLUDE — qualifier: include
 * include ':core', ':modules:auth'
 *
 * // STATEMENT — catch-all for everything else
 * exclude group: 'org.unwanted'
 * ```
 */
export enum GradleDeclarationType {
  /** All dependency declarations — regular, constraint, classpath, default, platform.
   *  Block hierarchy distinguishes context (inside buildscript/constraints/etc.).
   *  notation: GradleDependencyNotation, qualifier: config name */
  DEPENDENCY = 'DEPENDENCY',

  /** All plugin applications — plugins block, apply plugin, apply from.
   *  notation: GradlePluginSyntax */
  PLUGIN = 'PLUGIN',

  /** Repository declarations.
   *  notation: GradleRepositoryType */
  REPOSITORY = 'REPOSITORY',

  /** Property/variable assignments — project props, ext, local vars, rootProject.name.
   *  qualifier: GradlePropertyScope */
  PROPERTY = 'PROPERTY',

  /** Task definitions.
   *  notation: GradleTaskStyle, qualifier: task type (Copy, Exec, etc.) */
  TASK = 'TASK',

  /** Custom configuration declarations.
   *  name: config name, value: extendsFrom */
  CONFIGURATION = 'CONFIGURATION',

  /** Settings includes — include, includeBuild.
   *  name: path, qualifier: "include" or "includeBuild" */
  INCLUDE = 'INCLUDE',

  /** Everything else: method calls, excludes, artifacts, resolution rules,
   *  catalog entries, imports, return, throw, class defs, etc.
   *  name: statement kind or method name, value: arguments/expression */
  STATEMENT = 'STATEMENT',
}
