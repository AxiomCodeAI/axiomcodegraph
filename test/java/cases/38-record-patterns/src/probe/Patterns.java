package probe;

/**
 * PATTERN BINDINGS as call receivers (JLS 14.30.1, and record deconstruction from JEP 440).
 *
 * A pattern binds a variable with a written type, exactly as a declaration does, but the IR shapes
 * the two differently: a use site of a binding is tagged PATTERN_BINDING_VARIABLE rather than
 * LOCAL_VARIABLE, and a record component's type reference is owned by the enclosing RECORD_PATTERN
 * expression rather than by the component's own local. Every call on a bound name was therefore a
 * declared unknown, however well the type had been resolved.
 */
public class Patterns {

    sealed interface Node permits Leaf, Pair, Other {}
    record Leaf(String value) implements Node { String render() { return "L"; } }
    record Pair(Node left, Node right) implements Node { String render() { return "P"; } }
    static final class Other implements Node { String render() { return "O"; } }

    /** A bare instanceof pattern. */
    String bare(Node n) {
        if (n instanceof Leaf l) return l.render();
        return "";
    }

    /** A record DECONSTRUCTION: the component binds a name with a written type. */
    String deconstruct(Node n) {
        if (n instanceof Pair(Leaf a, Node ignored)) return a.render();
        return "";
    }

    /** Both components used, so the join cannot be right by accident of there being one. */
    String bothComponents(Node n) {
        if (n instanceof Pair(Leaf a, Leaf b)) return a.render() + b.render();
        return "";
    }

    /** Deconstruction in a switch arm, alongside a plain type pattern. */
    String inSwitch(Node n) {
        return switch (n) {
            case Pair(Leaf a, Node ig) -> a.render();
            case Leaf l -> l.render();
            case Other o -> o.render();
            default -> "";
        };
    }

    /** A negated pattern, whose binding is in scope for the rest of the method. */
    String negated(Node n) {
        if (!(n instanceof Leaf l)) return "";
        return l.render();
    }
}
