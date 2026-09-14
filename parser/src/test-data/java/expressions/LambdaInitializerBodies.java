package com.axiomcode.test.expressions;

import java.util.function.Consumer;

/**
 * Acceptance fixture for statements inside a lambda that initializes a local or
 * a field.
 *
 * Two shapes produced no rows at all, so those call sites were neither edges nor
 * declared unknowns.
 *
 * (a) A BRACE-LESS control-flow body. Statements inside such a lambda are
 * deliberately skipped by the method walk and handed to the local-variable
 * walk instead, but that walk dispatches on a node's CHILDREN. A brace-less
 * body is the statement itself rather than a block, so it was never dispatched
 * and its calls vanished - while the identical code inside braces was extracted
 * normally. It affected if, while and for alike.
 *
 * (b) A THROW in a field-initializer lambda. Neither side handled it: the method
 * walk skips lambda bodies here, and the local-variable walk had no branch for
 * a throw. A throw inside a lambda that initializes a LOCAL was already covered
 * by the enclosing method's own throw pass, which is why the fix is scoped to
 * field initializers - extracting both would report one written throw twice.
 *
 * The braced forms and the argument-lambda form are the controls: they were
 * always correct, and they pin that the fix adds rows without duplicating any.
 */
public class LambdaInitializerBodies {

    void x() { }
    void y() { }
    boolean c;

    /** Control: the same statements outside any lambda. */
    void plain() {
        if (c) x(); else y();
    }

    /** Control: braces, which were always extracted. */
    void bracedInLambda() {
        Consumer<String> h = s -> { if (c) { x(); } else { y(); } };
        h.accept("a");
    }

    /** (a) brace-less if/else inside a lambda initializing a local. */
    void unbracedIf() {
        Consumer<String> h = s -> {
            if (c)
                x();
            else
                y();
        };
        h.accept("a");
    }

    /** (a) brace-less while body. */
    void unbracedWhile() {
        Consumer<String> h = s -> { while (c) x(); };
        h.accept("a");
    }

    /** (a) brace-less for body. */
    void unbracedFor() {
        Consumer<String> h = s -> { for (int i = 0; i < 1; i++) x(); };
        h.accept("a");
    }

    /** Control: the same lambda as an argument was always extracted. */
    void asArgument() {
        run(s -> { if (c) x(); else y(); });
    }

    /** (b) a throw in a field-initializer lambda. */
    Consumer<String> thrower = s -> { throw new RuntimeException("boom"); };

    /** Control: a throw in a LOCAL-initializer lambda, already covered elsewhere. */
    void throwInLocalLambda() {
        Consumer<String> h = s -> { throw new IllegalStateException("local"); };
        h.accept("a");
    }

    void run(Consumer<String> f) { }
}
