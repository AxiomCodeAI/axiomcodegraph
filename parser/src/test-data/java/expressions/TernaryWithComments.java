package com.axiomcode.test.expressions;

/**
 * Acceptance fixture for a comment inside a conditional expression (JLS 15.25).
 *
 * The three operands were read as namedChildren[0..2], which assumed they are
 * the only named children of the ternary. A comment is a named child, and
 * tree-sitter attaches it to the field it follows, so a comment before the `?`
 * yielded [condition, comment, trueExpr, falseExpr]: the true branch was read as
 * the comment, the true operand was emitted under TERNARY_FALSE, and the false
 * operand was never read at all.
 *
 * Two defects at once, and in the worse order. A dropped branch is a call site
 * with no row; the mislabelled one is a row asserting a role the source does not
 * have, so a consumer following the false branch reaches the true expression.
 *
 * The grammar labels these `condition`, `consequence` and `alternative`. Every
 * position a comment can occupy is covered below, because the shift depends on
 * which field the comment attaches to and each position attaches differently.
 *
 * All eight ternaries must produce the same three roles. The control at the top
 * is the reference: whatever it produces, each of the others must produce too.
 */
public class TernaryWithComments {

    String a() { return "a"; }
    String b() { return "b"; }
    boolean c;

    /** Control: no comment. */
    String control() {
        return c ? a() : b();
    }

    /** Line comment before the `?` - the form that mislabelled a branch. */
    String lineBeforeQuestion() {
        return c //
            ? a()
            : b();
    }

    /** Line comment after the `?`. */
    String lineAfterQuestion() {
        return c
            ? a() //
            : b();
    }

    String blockBeforeQuestion()  { return c /* x */ ? a() : b(); }

    String blockAfterQuestion()   { return c ? /* x */ a() : b(); }

    String blockBeforeColon()     { return c ? a() /* x */ : b(); }

    String blockAfterColon()      { return c ? a() : /* x */ b(); }

    /** A comment in every position at once. */
    String everywhere() {
        return c /* 1 */ ? /* 2 */ a() /* 3 */ : /* 4 */ b();
    }
}
