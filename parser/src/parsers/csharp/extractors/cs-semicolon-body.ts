/**
 * C# 12's SEMICOLON-BODIED TYPE DECLARATION, made readable before parsing.
 *
 * `public interface ILock : IBase;` declares a type with no members. The
 * published grammar has no rule for it, and what it recovers is not a
 * recognisable header:
 *
 *   ONE such declaration in a file gives an `ERROR` holding the whole header
 *   and a stray `global_statement` for the `;` — so there is no `cs_type` row,
 *   and the stray statement makes the file look like a top-level-statements
 *   program, which mints a `<Main>$` method and a synthesised `Program` type
 *   the file does not contain. One missing type and two invented rows.
 *
 *   SEVERAL in a file is worse: the recovery merges them into a SINGLE
 *   `class_declaration` named after the last one, with the earlier
 *   declarations as `ERROR` children of its header and the next real type's
 *   `{ }` as its body. Six declarations came out as one type, and the type it
 *   named was the wrong one.
 *
 * The second shape is why this is a source rewrite rather than a tree read. A
 * tree read works on the single-declaration case and cannot work on the merged
 * one: the parts are no longer grouped by declaration, and nothing in the tree
 * says where one header ends and the next begins.
 *
 * ## Why a rewrite is safe here, stated precisely
 *
 * The rule is the one `#if` blanking follows — hand the grammar ordinary C# —
 * with one difference: `{}` is ONE CHARACTER LONGER than `;`, so this pass is
 * not length-preserving and blanking is. That is acceptable only because of
 * WHERE the character is added:
 *
 *   - The rewrite fires only when the `;` is the last non-whitespace character
 *     on its line, so NO TOKEN FOLLOWS IT ON THAT LINE. Every line number and
 *     every column on every other line is unchanged.
 *   - `cs_type` records `startLine`, `endLine` and `startColumn` — there is no
 *     `endColumn` on a type — so the one position that moves is not recorded
 *     anywhere.
 *   - A type body of `{}` holds no members, so no row is derived from inside
 *     the added characters.
 *
 * Byte offsets after a rewrite site shift by one, which is why the fact
 * extractor measures coverage against the PARSED text rather than the original.
 *
 * ## Measured
 *
 * 511 declarations in 304 files across seven codebases — linq-heavy 349, the
 * holdout 135, source-generator-B 10, source-generator-A 9, library-A 5, multitarget-B 2,
 * framework-bcl 1 — and rising: it is the idiomatic spelling of a marker interface in
 * current C#. modern-app, old-style-A, multitarget-A, old-style-B and desktop-A have none, which is
 * what a language-version boundary looks like in a corpus.
 */

/**
 * A type declaration whose body is a semicolon.
 *
 * Anchored at the START OF A LINE and ended by a `;` that is the last
 * non-whitespace character on ITS line, which is what makes the rewrite's extra
 * character unobservable. Both are required, so `class A; class B;` on one line
 * is left alone: the second declaration's columns would move, and a rewrite
 * that moves a recorded position is not this pass's bargain.
 *
 * The parts between are every header a C# type declaration may carry:
 *
 *   attributes     `[Obsolete]` on its own line or inline
 *   modifiers      including `partial`, `file`, `ref` and `readonly`
 *   the keyword    `class`, `interface` or `struct` — NOT `record`, which the
 *                  grammar already reads with a semicolon body, and NOT
 *                  `enum` or `delegate`, which cannot have one
 *   the name       with optional type parameters
 *   a primary constructor    `class C(int x);`
 *   a base list    possibly spanning lines: `class D<T> :\n    Base<T>;`
 *   constraints    `class C<T> where T : struct;`
 *
 * `[^{};]` in the tail parts is what stops a match running past a real body or
 * swallowing a following declaration: a `{` or a second `;` ends the candidate
 * immediately.
 */
const SEMICOLON_BODIED_TYPE =
  /(^[ \t]*(?:\[[^\]\n]*\][ \t]*\n?[ \t]*)*(?:(?:public|internal|private|protected|abstract|sealed|static|partial|file|unsafe|new|readonly|ref)[ \t]+)*(?:class|interface|struct)[ \t]+[A-Za-z_][A-Za-z0-9_]*(?:[ \t]*<[^<>{};\n]*>)?(?:[ \t]*\([^();{}]*\))?(?:[ \t]*:[^{};]*?)?(?:[ \t\r\n]+where[^{};]*?)?)[ \t]*;(?=[ \t]*(?:\r?\n|$))/gm;

/**
 * Rewrites every semicolon body to an empty block, and says how many.
 *
 * The count is returned rather than logged because it is an input to the
 * assertion that this pass is still needed: when the published grammar grows a
 * rule for the shape, the count stays the same and the gate that measures the
 * unrewritten text is what notices.
 */
export function rewriteSemicolonBodies(text: string): {
  readonly text: string;
  readonly count: number;
} {
  let count = 0;
  const rewritten = text.replace(SEMICOLON_BODIED_TYPE, (_match, header: string) => {
    count += 1;
    return `${header}{}`;
  });
  return { text: rewritten, count };
}
