package com.axiom.test.blocks;

/**
 * Nested-block linking test.
 *
 * `nested` builds a 4-deep control-flow chain (IF > FOR > WHILE > IF) so the
 * parser must link each inner block's parentContainerHash to its enclosing
 * block, producing strictly increasing nesting depth.
 *
 * `exceptions` has one try with two catches and a finally: every CATCH and the
 * FINALLY must share the SAME tryStatementHash, and that hash must resolve to a
 * TRY block. `tryWithResources` adds a TRY_WITH_RESOURCES variant.
 */
public class NestedBlockLinking {

    void nested(int n) {
        if (n > 0) {
            for (int i = 0; i < n; i++) {
                while (i < 5) {
                    if (i == 2) {
                        break;
                    }
                }
            }
        } else {
            System.out.println("neg");
        }
    }

    void exceptions() {
        try {
            risky();
        } catch (IllegalArgumentException e) {
            log(e);
        } catch (RuntimeException e) {
            log(e);
        } finally {
            cleanup();
        }
    }

    void tryWithResources() {
        try (AutoCloseable a = open()) {
            use(a);
        } catch (Exception e) {
            log(e);
        }
    }

    void risky() { }

    void log(Object e) { }

    void cleanup() { }

    void use(Object a) { }

    AutoCloseable open() {
        return null;
    }
}
