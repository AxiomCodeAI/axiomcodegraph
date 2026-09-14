/**
 * How a task is defined or configured in a Gradle build file.
 *
 * ## Examples
 *
 * ```groovy
 * // TASK_KEYWORD
 * task hello { doLast { println 'Hello' } }
 *
 * // TASK_KEYWORD_TYPED
 * task compileExtra(type: JavaCompile) { source = ... }
 *
 * // TASKS_REGISTER
 * tasks.register('hello') { doLast { println 'Hello' } }
 *
 * // TASKS_REGISTER_TYPED
 * tasks.register('copyDocs', Copy) { from 'docs' }
 * tasks.register<Copy>("copyDocs") { from("docs") }
 *
 * // TASKS_NAMED
 * tasks.named('test') { useJUnitPlatform() }
 *
 * // TASKS_NAMED_TYPED (Kotlin DSL)
 * tasks.named<Test>("test") { useJUnitPlatform() }
 *
 * // DIRECT_CONFIGURE
 * compileJava { options.encoding = 'UTF-8' }
 *
 * // TASK_RULE
 * tasks.addRule("Pattern: deploy<Env>") { ... }
 *
 * // LOOP_CREATION
 * ['dev','prod'].each { env -> task "deploy${env}" { ... } }
 * ```
 */
export enum GradleTaskStyle {
  /** task hello { } */
  TASK_KEYWORD = 'TASK_KEYWORD',

  /** task compileExtra(type: JavaCompile) { } */
  TASK_KEYWORD_TYPED = 'TASK_KEYWORD_TYPED',

  /** tasks.register('hello') { } */
  TASKS_REGISTER = 'TASKS_REGISTER',

  /** tasks.register('copyDocs', Copy) { } or tasks.register<Copy>("x") { } */
  TASKS_REGISTER_TYPED = 'TASKS_REGISTER_TYPED',

  /** tasks.named('test') { } */
  TASKS_NAMED = 'TASKS_NAMED',

  /** tasks.named<Test>('test') { } (Kotlin DSL) */
  TASKS_NAMED_TYPED = 'TASKS_NAMED_TYPED',

  /** compileJava { } — direct name as method call */
  DIRECT_CONFIGURE = 'DIRECT_CONFIGURE',

  /** tasks.addRule("Pattern: ...") { } */
  TASK_RULE = 'TASK_RULE',

  /** ['dev','prod'].each { task "deploy${it}" { } } */
  LOOP_CREATION = 'LOOP_CREATION',
}
