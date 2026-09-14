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
 *
 * `assert_statement` carries NO grammar fields, so the two halves have to be found in the child
 * list rather than asked for by name -- and `line_comment` / `block_comment` are NAMED nodes, so
 * a read that takes the first two named children takes a comment as an operand. The commented
 * shapes at the end of this file are what discriminate that: with the halves split on the `:`
 * token instead, a comment in any position is inert. A BLOCK comment before the condition is
 * the worst of them -- it reported the condition call as the MESSAGE and dropped the real
 * message, a wrong context rather than a missing row.
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

    // ── Comments. Each of these holds the same two calls as conditionAndMessage above, so the
    //    expected row set is identical: check() as the condition, msg() as the message. ──

    /** A line comment between the condition and the `:`. The message produced no rows. */
    void commentBeforeColon() {
        assert check() // why
            : msg();
    }

    /** A block comment before the condition: reported check() as the MESSAGE, dropped msg(). */
    void commentBeforeCondition() {
        assert /* invariant */ check() : msg();
    }

    /** A comment after the `:`, before the message. */
    void commentAfterColon() {
        assert check() : /* detail */ msg();
    }

    /** A comment in a condition-only assert, where there is no `:` to split on. */
    void commentInConditionOnly() {
        assert /* invariant */ check();
    }

    /** A comment in every position at once. */
    void commentEverywhere() {
        assert /* a */ check() /* b */ : /* c */ msg(); // d
    }
}
