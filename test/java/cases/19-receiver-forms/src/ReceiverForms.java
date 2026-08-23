// Every syntactic form a RECEIVER can take. Each one needs its own typing path, so a gap here is
// invisible in tests that only use a plain local variable as the receiver.
import java.util.ArrayList;
import java.util.List;

public class ReceiverForms {

    interface Node { String tag(); }
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
    String viaChained(List<Node> l)     { return l.get(0).tag(); }           // chained lib call
    String viaVarargs()                 { return join("-", "a", "b", "c"); } // varargs call
    String viaNewDirect()               { return new Leaf().tag(); }         // `new` as receiver
    String viaStringLiteral()           { return "abc".substring(1); }       // literal receiver

    public static void main(String[] a) {
        ReceiverForms r = new ReceiverForms();
        List<Node> l = new ArrayList<>(); l.add(new Leaf());
        System.out.println(r.viaArrayElement(new Node[]{ new Leaf() })
            + r.viaTernary(new Leaf(), new Twig(), true) + r.viaCast(new Leaf())
            + r.viaInstanceofPattern(new Twig()) + r.viaParenthesized(new Leaf())
            + r.viaChained(l) + r.viaVarargs() + r.viaNewDirect() + r.viaStringLiteral());
    }
}
