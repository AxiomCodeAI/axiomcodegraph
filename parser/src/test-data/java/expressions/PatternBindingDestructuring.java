package expressions;

/**
 * The USE site of a pattern binding is a `PATTERN_BINDING_VARIABLE`, not a `FIELD`.
 *
 * `currentPatternBindingNames` is populated while the `instanceof` is extracted, but the
 * binding is USED in a different statement, and therefore in a different extraction call:
 * `if (o instanceof Target a)` is an `if` condition, `a.hit()` is an expression statement — and
 * expression statements are extracted BEFORE control-flow conditions, so the use site was
 * reached before the binding existed. `addIdentifierReferenceData` then fell through to
 * `classifyByNamingConvention`, which returns `FIELD` for any lowercase name.
 *
 * Where the binding SHADOWS a field of another type — legal and unambiguous per JLS 6.3.1 and
 * 14.30.2 — that is a wrong answer rather than a weak one: the engine answers the call site
 * with the field's type as well, and since the field's type is not a subtype of the binding's,
 * that extra target is not inside a sound envelope either. It also means an unresolved binding
 * cannot be told apart from an unresolved field.
 *
 * The second half of this fixture is about the OPPOSITE error. The four statement entry points
 * never reset the binding set, so names leaked from one extraction call into the next — and,
 * because the extractor instance is reused, from one FILE into the next: ordinary field reads
 * in files containing no pattern at all were tagged `PATTERN_BINDING_VARIABLE`. `NoPatterns`
 * below declares fields with the same names as the bindings above and reads them, so a leak
 * shows up as a field read tagged as a binding.
 */
public class PatternBindingDestructuring {

    /** A field of a DIFFERENT type from the binding that shadows it. This is the whole point. */
    Other shadowed = new Other();

    /** The core case: the binding `shadowed` shadows the field `shadowed`. */
    void bindingShadowsAField(Object o) {
        if (o instanceof Target shadowed) {
            shadowed.hit();
        }
    }

    /** A binding used in a following statement, with no field of that name at all. */
    void bindingInFollowingStatement(Object o) {
        if (o instanceof Target bound) {
            bound.hit();
        }
    }

    /** A binding used in the SAME expression as the instanceof — this always worked. */
    boolean bindingInSameExpression(Object o) {
        return o instanceof Target inline && inline.ready();
    }

    /** A record pattern's components are bindings too, and were tagged FIELD the same way. */
    String recordPatternComponents(Object o) {
        if (o instanceof Pair(String left, String right)) {
            return left + right;
        }
        return "";
    }

    /** A nested record pattern, so the recursion has to reach the inner components. */
    String nestedRecordPattern(Object o) {
        if (o instanceof Outer(Pair(String inner, String other), String tail)) {
            return inner + other + tail;
        }
        return "";
    }

    /** A switch type pattern binding, used in the arm. */
    int switchTypePattern(Object o) {
        return switch (o) {
            case Target hit -> hit.size();
            default -> 0;
        };
    }

    record Pair(String left, String right) { }
    record Outer(Pair pair, String tail) { }

    static class Other { void hit() {} }
    static class Target { void hit() {} boolean ready() { return true; } int size() { return 1; } }
}

/**
 * No pattern of any kind. Every read below is a genuine field read, and each name is also a
 * binding name in the class above — so if the binding set leaks, these are tagged
 * PATTERN_BINDING_VARIABLE and the fixture says so.
 */
class NoPatterns {

    int bound;
    int inline;
    int left;
    int right;
    int inner;
    int hit;

    int readsFields() {
        return bound + inline + left + right + inner + hit;
    }

    int alsoReadsFields() {
        int total = bound;
        total += left;
        return total + hit;
    }
}
