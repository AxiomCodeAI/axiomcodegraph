package com.axiomcode.test.expressions;

/**
 * Acceptance fixture for arrow arms of a switch used as a VALUE.
 *
 * `case 1 -> t();` is written as an expression_statement, and
 * `case 1 -> throw e;` as a throw_statement, whichever form the switch takes.
 * Collecting every expression statement therefore picked the arm up a second
 * time, once correctly as the arm's result and once again as a top-level
 * statement of the enclosing method. One written call site became two rows, and
 * the spurious one asserted a root context the source does not have: the arm's
 * value is the switch's value, not a statement in the method.
 *
 * The two forms are told apart by what the switch is attached to. A switch used
 * as a statement sits directly in a block; one used as a value sits under
 * whatever consumes it. Every consuming position is covered below, because the
 * distinction is made on the parent node and each parent is a different type.
 *
 * The statement form at the bottom is the control: there the arm really is a
 * statement, and its single row is correct and must stay.
 */
public class SwitchArmDuplication {

    int t() { return 1; }
    int u(int x) { return x; }
    int f;

    /** Consumed by a return. */
    int inReturn(int k) {
        return switch (k) { case 1 -> t(); default -> 0; };
    }

    /** Consumed by a variable declarator. */
    void inLocalVar(int k) {
        int v = switch (k) { case 1 -> t(); default -> 0; };
    }

    /** Consumed by an argument list. */
    void inArgument(int k) {
        u(switch (k) { case 1 -> t(); default -> 0; });
    }

    /** Consumed by an assignment. */
    void inField(int k) {
        f = switch (k) { case 1 -> t(); default -> 0; };
    }

    /** A throw arm is a throw_statement, collected by a different pass. */
    int inThrowArm(int k) {
        return switch (k) { case 1 -> throw new RuntimeException(); default -> 0; };
    }

    /** A block arm was always correct: its yield is not an arm-level statement. */
    int inYieldBlock(int k) {
        return switch (k) { case 1 -> { yield t(); } default -> 0; };
    }

    /** The colon form was always correct. */
    int colonForm(int k) {
        return switch (k) { case 1: yield t(); default: yield 0; };
    }

    /** Control: a switch used as a STATEMENT. Its arm is a statement, and stays one. */
    void asStatement(int k) {
        switch (k) { case 1 -> t(); default -> { } }
    }
}
