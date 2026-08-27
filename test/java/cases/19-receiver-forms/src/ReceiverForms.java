// Every syntactic form a RECEIVER can take. Each one needs its own typing path, so a gap here is
// invisible in tests that only use a plain local variable as the receiver.
//
// The chained-call receiver goes through a CLIENT generic (Box<Node>) rather than
// java.util.List. What it pins down is the same thing either way — a chained call must be
// typed by the RETURN type of the call it is chained onto, with the generic's type argument
// substituted — but keeping it client-side means this suite needs no library IR at all.
public class ReceiverForms {

    interface Node { String tag(); }

    /** A minimal client generic, standing in for the JDK collection this used to use. */
    static class Box<T> {
        private T value;
        void put(T v) { value = v; }
        T get(int i)  { return value; }
    }
    static class Leaf implements Node { public String tag() { return "leaf"; } }
    static class Twig implements Node { public String tag() { return "twig"; } }

    static String join(String sep, String... parts) {       // varargs callee
        return parts.length + sep;
    }

    String viaArrayElement(Node[] ns)   { return ns[0].tag(); }             // array element
    String viaTernary(Node a, Node b, boolean f) { return (f ? a : b).tag(); }  // ternary
    String viaCast(Object o)            { return ((Leaf) o).tag(); }        // cast
    String viaInstanceofPattern(Object o) {                                  // pattern binding
        if (o instanceof Twig t) return t.tag();
        return "";
    }
    String viaParenthesized(Node n)     { return (n).tag(); }                // parenthesized
    String viaChained(Box<Node> b)      { return b.get(0).tag(); }           // chained call
    String viaVarargs()                 { return join("-", "a", "b", "c"); } // varargs call
    String viaNewDirect()               { return new Leaf().tag(); }         // `new` as receiver
    String viaStringLiteral()           { return "abc".substring(1); }       // literal receiver

    public static void main(String[] a) {
        ReceiverForms r = new ReceiverForms();
        Box<Node> l = new Box<>();
        l.put(new Leaf());
        System.out.println(r.viaArrayElement(new Node[]{ new Leaf() })
            + r.viaTernary(new Leaf(), new Twig(), true) + r.viaCast(new Leaf())
            + r.viaInstanceofPattern(new Twig()) + r.viaParenthesized(new Leaf())
            + r.viaChained(l) + r.viaVarargs() + r.viaNewDirect() + r.viaStringLiteral());
    }
}
