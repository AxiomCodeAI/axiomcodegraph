package com.axiomcode.test.expressions;

/**
 * Acceptance fixture for the three clauses of a basic for statement.
 *
 * The update pass matched children of the for_statement by NODE TYPE, so a
 * condition that happened to be a method_invocation, a unary or an assignment
 * matched the update set too and was emitted a second time with FOR_UPDATE. An
 * expression init clause matched as well, so `for (init(); cond(); step())`
 * produced three FOR_UPDATE rows for one update clause, and RootContext.FOR_INIT
 * was declared and emitted by nothing.
 *
 * Two consequences in opposite directions: a duplicated site inflates any
 * per-site denominator, and a call written in the init clause, which runs once,
 * was reported in the clause that runs every iteration - which is the whole
 * reason the three contexts are separate.
 *
 * The grammar labels these clauses `init`, `condition` and `update`, so the
 * fixture below covers each shape that previously collided with the type match.
 */
public class ForClauseContexts {

    boolean cond() { return false; }
    void init() { }
    void step() { }
    boolean flag;

    /** Every clause is a call: one row each, in its own context. */
    void allCalls() {
        for (init(); cond(); step()) { }
    }

    /** A call condition must not also appear as an update. */
    void callCondition() {
        for (int i = 0; cond(); i++) { }
    }

    /** A unary condition must not also appear as an update. */
    void unaryCondition() {
        for (int i = 0; !flag; i++) { }
    }

    /** Control: a binary condition never matched the type set, and is unchanged. */
    void binaryCondition() {
        for (int i = 0; i < 3; i++) { }
    }

    /** A clause may repeat, and each repetition is its own row. */
    void multipleClauses() {
        int i, j;
        for (i = 0, j = 10; i < j; i++, j--) { }
    }

    /** No clause at all: nothing to extract, and nothing to duplicate. */
    void empty() {
        for (;;) { break; }
    }
}
