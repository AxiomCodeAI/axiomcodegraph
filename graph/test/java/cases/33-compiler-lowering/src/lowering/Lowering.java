package lowering;

// Constructs javac LOWERS into invoke instructions the source never wrote. Ground truth is read
// from bytecode, so each of these looks like a call site the engine failed to find — and every
// one of them is a call no reader of this file would say exists.
//
// Each lowering is paired with the EXPLICIT form of the same call, which must survive: an
// exclusion that also removed the written call would trade one measurement error for another.

import java.io.IOException;
import java.io.StringReader;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Objects;

public class Lowering {

    // ── UNBOXING ── javac inserts Integer.intValue() / Boolean.booleanValue() / Long.longValue()
    int unboxInt(Integer boxed) { return boxed; }
    boolean unboxBool(Boolean boxed) { return boxed; }
    long unboxLong(Long boxed) { return boxed; }
    int explicitUnbox(Integer boxed) { return boxed.intValue(); }          // written: cost of the exclusion

    // ── BOUND METHOD REFERENCE ── javac inserts Objects.requireNonNull(sink) before the indy
    void boundRef(List<String> items, Sink sink) { items.forEach(sink::accept); }
    Sink explicitRequireNonNull(Sink sink) { return Objects.requireNonNull(sink); }   // written: must survive

    // ── ENHANCED FOR ── javac inserts iterator() / hasNext() / next()
    void overIterable(Iterable<String> xs) { for (String x : xs) use(x); }
    void overClientIterable(Bag xs) { for (String x : xs) use(x); }       // owner is a CLIENT type
    void explicitIterator(Bag xs) {                                       // written: cost of the exclusion
        Iterator<String> it = xs.iterator();
        while (it.hasNext()) use(it.next());
    }

    // ── TRY-WITH-RESOURCES ── javac inserts close() and Throwable.addSuppressed()
    void tryWithResources(String text) throws IOException {
        try (StringReader r = new StringReader(text)) { use(String.valueOf(r.read())); }
    }

    // controls: ordinary calls, which every exclusion must leave alone
    void use(String s) { s.trim(); }
    void plainLibraryCall(List<String> l) { l.size(); }
    void plainClientCall(Bag b) { b.size(); }

    interface Sink { void accept(String s); }

    static class Bag implements Iterable<String> {
        private final List<String> items = new ArrayList<>();
        int size() { return items.size(); }
        @Override public Iterator<String> iterator() { return items.iterator(); }
    }
}
