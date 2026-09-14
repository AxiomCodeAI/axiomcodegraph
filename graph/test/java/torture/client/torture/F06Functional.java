package torture;

// f06 — LAMBDAS AND METHOD REFERENCES. The target is a value, not a name at the call site. All four
// reference forms, plus a lambda stored in a field, a local, and a collection.

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.function.BiFunction;

public class F06Functional {

    static class Item {
        private final String n;
        Item(String n) { this.n = n; }
        String name() { return n; }
        static String upper(String s) { return s.toUpperCase(); }
        String prefixed(String p) { return p + n; }
    }

    interface Sink { String apply(Item i); }

    private Sink field = i -> i.name();                       // lambda in a field initializer
    private final Map<String, Function<Item, String>> table = new HashMap<>();
    private final List<Function<Item, String>> chain = new ArrayList<>();

    // STATIC method reference
    Function<String, String> staticRef() { return Item::upper; }
    // UNBOUND instance method reference — the receiver is the SAM's first parameter
    Function<Item, String> unboundRef() { return Item::name; }
    // BOUND instance method reference — the receiver is captured
    Supplier<String> boundRef(Item i) { return i::name; }
    // CONSTRUCTOR reference
    Function<String, Item> ctorRef() { return Item::new; }
    // unbound reference to a method that TAKES an argument: SAM arity is 2
    BiFunction<Item, String, String> unboundWithArg() { return Item::prefixed; }

    // invoked through the field
    String viaField(Item i) { return field.apply(i); }
    // invoked through a local
    String viaLocal(Item i) { Sink s = x -> x.name(); return s.apply(i); }
    // invoked through a map lookup — the target is whichever lambda was put under that key
    String viaTable(String k, Item i) { return table.get(k).apply(i); }
    // invoked through a list, in a loop
    String viaChain(Item i) { String out = ""; for (Function<Item, String> f : chain) out = f.apply(i); return out; }
    // a lambda passed straight to a higher-order method and invoked there
    String viaHigherOrder(Item i) { return applyTwice(i, x -> x.name()); }
    static String applyTwice(Item i, Function<Item, String> f) { f.apply(i); return f.apply(i); }
    // a lambda BODY containing a call — the call belongs to the enclosing method
    List<String> insideLambda(List<Item> xs) { List<String> out = new ArrayList<>(); xs.forEach(i -> out.add(i.name())); return out; }

    void wire() {
        table.put("name", Item::name);
        table.put("upper", i -> Item.upper(i.name()));
        chain.add(Item::name);
    }
}
