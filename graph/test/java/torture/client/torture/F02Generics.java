package torture;

// f02 — GENERICS. Type-variable substitution through inheritance, a bounded variable, a recursive
// bound, a generic method inferred from its argument, and a library generic the client parameterises.

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

import dep.Registry;
import dep.Event;

public class F02Generics {

    static class Box<T> {
        private T value;
        void set(T v) { this.value = v; }
        T get() { return value; }
    }
    // the type argument is fixed by the SUBCLASS, so get() on it returns Node, not T
    static class NodeBox extends Box<Node> { }

    static class Node {
        String label() { return "n"; }
        Node child() { return this; }
    }

    interface Comparable2<T extends Comparable2<T>> { int cmp(T other); }   // recursive bound
    static class Version implements Comparable2<Version> {
        public int cmp(Version other) { return 0; }
        String text() { return "v"; }
    }

    static <T extends Node> T firstOf(List<T> xs) { return xs.get(0); }     // bounded generic method

    // substitution through a subclass: the answer is Node#label, and nothing about Box says Node
    String viaSubclassBinding(NodeBox b) { return b.get().label(); }
    // the same shape written inline
    String viaInlineBinding() { Box<Node> b = new Box<>(); return b.get().label(); }
    // the bound is what types the receiver
    int viaRecursiveBound(Version a, Version b) { return a.cmp(b); }
    // a generic method's return type is its type variable, inferred from the argument
    String viaGenericMethod(List<Node> xs) { return firstOf(xs).label(); }
    // a LIBRARY generic the client parameterises: Registry<Event>.get returns Event
    String viaLibraryGeneric(Registry<Event> r) { return r.get("k").name(); }
    // two hops through the same substitution
    String viaChainedGeneric(NodeBox b) { return b.get().child().label(); }
    // element type of a collection
    String viaElement(List<Node> xs) { return xs.get(0).label(); }
    // map value type
    String viaMapValue(Map<String, Node> m) { return m.get("k").label(); }

    List<Node> make() { return new ArrayList<>(); }
    Map<String, Node> makeMap() { return new HashMap<>(); }
}
