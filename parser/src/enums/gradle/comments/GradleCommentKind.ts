/**
 * Comment form in a Gradle script.
 *
 * Mirrors Java's CommentKind. Build files carry a disproportionate amount of
 * their meaning in comments — a pinned version almost always has a "// pinned
 * because …" beside it, and a commented-out dependency is a fact about what the
 * build deliberately does NOT have.
 *
 * ## Examples
 *
 * ```groovy
 * // line comment                      LINE
 * /* block comment *\/                 BLOCK
 * /** GroovyDoc *\/                    GROOVYDOC
 * #!/usr/bin/env groovy                SHEBANG
 * ```
 */
export enum GradleCommentKind {
  /** // ... */
  LINE = 'LINE',

  /** \/* ... *\/ */
  BLOCK = 'BLOCK',

  /** \/** ... *\/ */
  GROOVYDOC = 'GROOVYDOC',

  /** #! on line 1 of an executable script. */
  SHEBANG = 'SHEBANG',
}
