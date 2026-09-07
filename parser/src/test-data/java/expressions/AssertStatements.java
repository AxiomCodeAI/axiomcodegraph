package com.axiomcode.test.expressions;

import java.util.List;

/**
 * Acceptance fixture for `assert` (JLS 14.10).
 *
 * Both halves of an assert are ordinary expressions reaching the same code the
 * rest of the graph reaches, and they were extracted into nothing: not the
 * condition, not the detail message, and not the calls inside either. An absent
 * row is worse than a weak one, because nothing downstream can distinguish
 * "no call here" from "a call that was never recorded".
 *
 * The vocabulary already existed for this: RootContext.ASSERT_CONDITION and
 * ASSERT_MESSAGE, and ExpressionOwnerKind.ASSERT_STATEMENT, each documented with
 * a worked example naming this construct.
 */
public class AssertStatements {

    boolean check() { return true; }
    boolean check(int v) { return v > 0; }
    String msg() { return "m"; }

    /** Condition only: no detail message, so no ASSERT_MESSAGE row. */
    void conditionOnly() {
        assert check();
    }

    /** Both halves are calls, and both must be recorded as call sites. */
    void conditionAndMessage() {
        assert check() : msg();
    }

    /** A condition that is not a call still carries its operands. */
    void operands(int x) {
        assert x > 0 : "x must be positive";
    }

    /** Nested inside another statement's body: the walk must reach it. */
    void nested(List<Integer> xs) {
        if (!xs.isEmpty()) {
            assert check(xs.size()) : msg();
        }
        while (xs.size() > 100) {
            assert check(1);
            break;
        }
    }

    /** An assert is an expression position like any other. */
    void richExpressions() {
        assert new Runnable() { @Override public void run() { } } != null : "anon";
        assert switch (1) { default -> true; };
    }
}
