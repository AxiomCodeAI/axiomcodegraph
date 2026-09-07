package torture;

// f03 — `var`. The declared type is absent from the source, so every receiver below is typed only
// by the initializer's type. Each line is one interesting call.

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

public class F03Var {

    static class Widget {
        String id() { return "w"; }
        Widget parent() { return this; }
    }
    static Widget build() { return new Widget(); }
    static List<Widget> many() { return new ArrayList<>(); }

    String fromConstructor() { var w = new Widget(); return w.id(); }
    String fromFactory() { var w = build(); return w.id(); }
    String fromChain() { var w = build().parent(); return w.id(); }
    String fromGenericElement() { var xs = many(); return xs.get(0).id(); }
    String fromEnhancedFor() { for (var w : many()) return w.id(); return ""; }
    String fromIndexedFor() { var xs = many(); for (var i = 0; i < xs.size(); i++) { return xs.get(i).id(); } return ""; }
    String fromMapEntry() { var m = new HashMap<String, Widget>(); for (var e : m.entrySet()) return e.getValue().id(); return ""; }
    // The SAME two-hop nesting — Map#entrySet() : Set<Map.Entry<K,V>>, then Entry#getValue() : V —
    // reached through each receiver form. They resolve by different routes (the arguments are
    // written on an object creation, on a declaration, on a field, on a method's return), and each
    // one has to carry the receiver's K and V down into Map.Entry's own parameters.
    static Map<String, Widget> mapReturn() { return new HashMap<>(); }
    final Map<String, Widget> mapField = new HashMap<>();
    String fromMapEntryOnReturn() { for (var e : mapReturn().entrySet()) return e.getValue().id(); return ""; }
    String fromMapEntryOnField() { for (var e : mapField.entrySet()) return e.getValue().id(); return ""; }
    String fromMapEntryOnDeclared() { Map<String, Widget> m = new HashMap<>(); for (var e : m.entrySet()) return e.getValue().id(); return ""; }
    String fromTernary(boolean b) { var w = b ? build() : new Widget(); return w.id(); }
    String fromCast(Object o) { var w = (Widget) o; return w.id(); }
    String fromLambdaParam(List<Widget> xs) { xs.forEach((var w) -> w.id()); return ""; }
    String fromTryResource(java.io.StringReader r) throws Exception { try (var rr = r) { return String.valueOf(rr.read()); } }
    // var holding a library type, then a library call on it
    int fromLibraryVar() { var sb = new StringBuilder(); return sb.length(); }
}
