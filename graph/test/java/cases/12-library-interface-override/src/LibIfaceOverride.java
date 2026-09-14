// SHAPE 1 of the open d1 recall gap: dispatch through an interface DECLARED IN A DEPENDENCY into an
// application override. Here the dependency is the JDK, so the case is self-contained.
//
// A NAMED client class implements a library interface; a method takes the interface type and calls
// its method. The application override is the code that runs. Nothing in the source names it at the
// call site, so only hierarchy dispatch can find it.
//
// Distinct from case 02: there the implementor is an ANONYMOUS class (the allocation is visible at
// the call site, so allocation-type flow can resolve it). Here it is a named class constructed
// elsewhere — the shape that appears in real code as an injected strategy.
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.Function;

public class LibIfaceOverride {

    // client class implementing a LIBRARY interface
    static class ByLength implements Comparator<String> {
        @Override public int compare(String a, String b) { return probe(a) - probe(b); }
        static int probe(String s) { return s.length(); }
    }

    static class Shouty implements Function<String, String> {
        @Override public String apply(String s) { return mark(s); }
        static String mark(String s) { return s.toUpperCase(); }
    }

    // receiver is the LIBRARY interface type; the target is the application override
    int viaComparator(Comparator<String> c, String x, String y) { return c.compare(x, y); }
    String viaFunction(Function<String, String> f, String s)     { return f.apply(s); }

    // and through a library method that calls back into the override
    void viaLibrarySort(List<String> items) { items.sort(new ByLength()); }

    public static void main(String[] a) {
        LibIfaceOverride t = new LibIfaceOverride();
        System.out.println(t.viaComparator(new ByLength(), "aa", "b"));
        System.out.println(t.viaFunction(new Shouty(), "x"));
        List<String> l = new ArrayList<>(); l.add("aa"); l.add("b");
        t.viaLibrarySort(l);
    }
}
