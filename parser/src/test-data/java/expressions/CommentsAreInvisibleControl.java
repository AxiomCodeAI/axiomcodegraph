package com.axiomcode.test.expressions;

/**
 * The uncommented twin of CommentsAreInvisible.java.
 *
 * The two files hold identical code apart from the comments, and the test
 * asserts they extract to the same multiset of expression rows. This one is the
 * reference: whatever it produces is what the commented file must produce.
 */
public class CommentsAreInvisibleControl {

    int f() { return 1; }
    boolean c;
    Object o;

    int returnValue()      { return f(); }
    void throwValue()      { throw new RuntimeException(); }
    void expressionStmt()  { f(); }
    void ifCondition()     { if (c) { f(); } }
    void whileCondition()  { while (c) { f(); } }
    void instanceOf()      { if (o instanceof String s) { f(); } }
    int ternary()          { return c ? f() : 0; }
    void assertStatement() { assert c : "m"; }
    void parenthesized()   { int x = (f()); }
    void castExpression()  { Object x = (Object) f(); }
    void forClauses()      { for (int i = 0; c; i++) { } }
    int switchArm()        { return switch (1) { default -> f(); }; }
}
