package com.axiomcode.test.expressions;

/**
 * Acceptance fixture for the USE site of a pattern binding (JLS 6.3.1, 14.30.2).
 *
 * The declaration site was already correct, tagged PATTERN_BINDING. The use site
 * was not: it fell through to the naming-convention fallback and was tagged
 * FIELD.
 *
 * The reason is scope, not classification. The classifier checks a set of names
 * in scope, and that set was populated per extraction call. A binding is declared
 * in one statement and used in another - `if (o instanceof Target a) { a.hit(); }`
 * - and each statement is extracted by its own call, so the binding was already
 * out of scope by the time its use was classified.
 *
 * The consequence is worst where a binding shadows a field, which Java permits:
 * the use site then answers with the field's type as well as the binding's, and
 * that extra target is outside the sound envelope rather than inside it. The
 * mistagging itself is not limited to shadowing - it applied to every pattern
 * binding use - so the non-shadowing cases below matter as much as `shadowsField`.
 *
 * The genuine field references at the top are the control: they must stay FIELD.
 */
public class PatternBindingUseSites {

    Other shadowed = new Other();
    String plainField;

    /** Control: real field references, which must keep FIELD. */
    void realFields() {
        shadowed.hit();
        System.out.println(plainField);
    }

    /** The shadowing case: `shadowed` here is the binding, not the field. */
    void shadowsField(Object o) {
        if (o instanceof Target shadowed) {
            shadowed.hit();
        }
    }

    /** No shadowing, and it was mistagged just the same. */
    void noShadowing(Object o) {
        if (o instanceof Target t) {
            t.hit();
        }
    }

    /** A switch type pattern binding. */
    String switchPattern(Object o) {
        return switch (o) {
            case Target t -> t.toString();
            default -> "";
        };
    }

    /** Record pattern components are bindings too. */
    void recordPattern(Object o) {
        if (o instanceof Point(int x, int y)) {
            System.out.println(x + y);
        }
    }
}

record Point(int x, int y) { }
class Other { public void hit() { } }
class Target { public void hit() { } }
