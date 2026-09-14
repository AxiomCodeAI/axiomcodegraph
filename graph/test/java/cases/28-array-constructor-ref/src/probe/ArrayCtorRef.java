package probe;

import java.util.List;
import java.util.function.Function;
import java.util.function.IntFunction;

/**
 * `T[]::new` is an ARRAY_CONSTRUCTOR method reference: it allocates an array and calls nothing, so
 * call-edge-generation/call_chain.dl leaves it out of the call-site universe on purpose. This case
 * pins that decision from both directions.
 *
 * The three forms of `T[]::new` below must produce NO site and NO drop. The ordinary method
 * reference and constructor reference beside them must still be counted — so a change that starts
 * dropping a REAL method reference goes red here instead of hiding behind the same exclusion.
 */
public class ArrayCtorRef {

    static class Item {
        private final String name;
        Item(String name) { this.name = name; }
        String label()    { return this.name; }
    }

    // ── ARRAY_CONSTRUCTOR: array creation, not a call. No site, and no silent drop. ──────────
    String[] asArray(List<String> in) {
        return in.toArray(String[]::new);           // the idiom this exclusion exists for
    }

    String[][] asNestedArray(List<String[]> in) {
        return in.toArray(String[][]::new);         // two-dimensional, same kind
    }

    IntFunction<Item[]> arrayFactory() {
        return Item[]::new;                         // bound to a value, not passed as an argument
    }

    // ── real method references, which MUST still be sites ────────────────────────────────────
    Function<String, Item> ctorRef()   { return Item::new; }     // CONSTRUCTOR
    Function<Item, String> labelRef()  { return Item::label; }   // QUALIFIED_METHOD

    String useLabelRef(Item i) { return labelRef().apply(i); }
    Item   useCtorRef(String s) { return ctorRef().apply(s); }
}
