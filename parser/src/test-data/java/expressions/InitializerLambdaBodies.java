package expressions;

import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * Two statement shapes inside a lambda that initializes a local variable or a field produced no
 * rows at all.
 *
 * (a) An UNBRACED control-flow body. `findExpressionStatements` deliberately skips expression
 *     statements inside a lambda that sits in a local-variable declaration and hands them to
 *     this extractor, which owns the local-variable linking — the split is intentional. The gap
 *     was on the receiving side: the walker recognised a statement only where it appeared as a
 *     CHILD of a `block`, and a single-statement control-flow body is not a `block`, it is a
 *     bare statement child of the `if_statement` / `for_statement` / `while_statement`. A
 *     braced body, a `try` and a `switch` in the same lambda were fine, which is what made this
 *     easy to miss. One corpus project loses 37 call sites to this shape alone.
 *
 * (b) A `throw` inside a lambda that initializes a FIELD. TypeMethodExtractor's throw walk
 *     covers method bodies, including lambdas in a local-variable declaration, but never
 *     reaches a field initializer. A `throw`-only lambda is the standard "disabled
 *     implementation" constant.
 *
 * Every defective shape has its working control in this file: the same lambda passed as an
 * argument, the braced form, and the local-variable twin of the field lambda.
 */
public class InitializerLambdaBodies {

    void x() {}
    void y() {}
    boolean c;
    static String reason() { return "r"; }

    /** (b) the defect: a throw in a FIELD-initializer lambda. */
    Supplier<String> disabled = () -> { throw new IllegalStateException(reason()); };

    /** (b) the control: the identical lambda in a local variable, extracted all along. */
    void throwInLocalVariableLambda() {
        Supplier<String> t = () -> { throw new IllegalStateException(reason()); };
    }

    /** The control for (a): the same unbraced if/else as ordinary statements. */
    void unbracedInMethod() {
        if (c) x(); else y();
    }

    /** (a) the defect: an unbraced if/else in a local-variable-initializer lambda. */
    void unbracedIfInLocalVariableLambda() {
        Consumer<String> h = s -> {
            if (c)
                x();
            else
                y();
        };
        h.accept("a");
    }

    /** (a) the control: braced, in the same position — always worked. */
    void bracedIfInLocalVariableLambda() {
        Consumer<String> h = s -> {
            if (c) { x(); } else { y(); }
        };
        h.accept("a");
    }

    /** (a) the control: the same unbraced lambda passed as an ARGUMENT — always worked. */
    void unbracedIfInArgumentLambda() {
        run(s -> {
            if (c)
                x();
            else
                y();
        });
    }

    /** (a) an unbraced `for` body. */
    void unbracedForInLocalVariableLambda() {
        Consumer<String> h = s -> {
            for (int i = 0; i < 2; i++)
                x();
        };
        h.accept("a");
    }

    /** (a) an unbraced `while` body. */
    void unbracedWhileInLocalVariableLambda() {
        Consumer<String> h = s -> {
            while (c)
                x();
        };
        h.accept("a");
    }

    /** (a) an unbraced `do` body. */
    void unbracedDoInLocalVariableLambda() {
        Consumer<String> h = s -> {
            do
                x();
            while (c);
        };
        h.accept("a");
    }

    /** (a) an unbraced body in a FIELD-initializer lambda, the other owner of this walker. */
    Consumer<String> fieldHandler = s -> {
        if (c)
            x();
        else
            y();
    };

    void run(Consumer<String> f) {}
}
