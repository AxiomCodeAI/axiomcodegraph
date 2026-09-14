package com.axiomcode.test.expressions;

/**
 * Acceptance fixture for the invariant that a comment does not change extraction.
 *
 * tree-sitter models a comment as a NAMED child, so any read that indexes into
 * namedChildren shifts when a comment appears. That is not a corner case: a
 * comment in an ordinary position moved the operand out of the slot being read
 * and the expression was dropped entirely, giving a call site with no row, which
 * nothing downstream can distinguish from code that makes no call.
 *
 * Measured before the fix, on the constructs below: 6 of 22 expression rows
 * disappeared and one changed kind, taking an instanceof pattern binding with it.
 *
 * This file is the twin of CommentsAreInvisibleControl.java. The two are
 * identical apart from the comments, and the test asserts that they extract to
 * the same multiset of expression rows. Asserting the equivalence rather than a
 * fixed list is what makes the fixture cover constructs added later: any new
 * positional read that a comment can shift will break the pair.
 *
 * Comments are placed in the leading position wherever one is legal, because a
 * leading comment shifts index 0, which is the index nearly every read uses.
 */
public class CommentsAreInvisible {

    int f() { return 1; }
    boolean c;
    Object o;

    int returnValue()      { return /* a */ f(); }
    void throwValue()      { throw /* a */ new RuntimeException(); }
    void expressionStmt()  { /* a */ f(); }
    void ifCondition()     { if (/* a */ c) { /* b */ f(); } }
    void whileCondition()  { while (/* a */ c) { /* b */ f(); } }
    void instanceOf()      { if (o /* a */ instanceof /* b */ String s) { f(); } }
    int ternary()          { return c /* a */ ? /* b */ f() /* c */ : /* d */ 0; }
    void assertStatement() { assert /* a */ c /* b */ : /* c */ "m"; }
    void parenthesized()   { int x = (/* a */ f()); }
    void castExpression()  { Object x = (Object) /* a */ f(); }
    void forClauses()      { for (int i = /* a */ 0; /* b */ c; /* c */ i++) { } }
    int switchArm()        { return switch (1) { default -> /* a */ f(); }; }
}
