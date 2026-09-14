// Unqualified calls that must resolve OUTWARD through the enclosing scopes. Java resolves an
// unqualified name in the innermost scope first, then outward; a lookup that only searches the
// enclosing type and its ANCESTORS misses every one of these. This shape was found as a real miss
// on cassandra (anonymous FutureCallback bodies calling an outer method) and had no test.
import java.util.function.Supplier;

public class OuterAccess {

    String outerInstance() { return "oi"; }
    static String outerStatic() { return "os"; }

    // (a) ANONYMOUS class body -> outer INSTANCE method
    Supplier<String> anonToOuter() {
        return new Supplier<String>() {
            @Override public String get() { return outerInstance(); }
        };
    }

    // (b) ANONYMOUS class body -> outer STATIC method
    Supplier<String> anonToOuterStatic() {
        return new Supplier<String>() {
            @Override public String get() { return outerStatic(); }
        };
    }

    // (c) INNER (non-static) class -> outer instance method
    class Inner {
        String viaOuter() { return outerInstance(); }
    }

    // (d) STATIC NESTED class -> outer static method (instance is not in scope)
    static class Nested {
        String viaOuterStatic() { return outerStatic(); }
    }

    // (e) LOCAL class declared inside a method -> outer instance method
    String localClass() {
        class Local { String go() { return outerInstance(); } }
        return new Local().go();
    }

    // (f) TWO levels out: anonymous inside an inner class -> outermost instance method
    class Middle {
        Supplier<String> deep() {
            return new Supplier<String>() {
                @Override public String get() { return outerInstance(); }
            };
        }
    }

    public static void main(String[] a) {
        OuterAccess o = new OuterAccess();
        System.out.println(o.anonToOuter().get() + o.anonToOuterStatic().get()
                         + o.new Inner().viaOuter() + new Nested().viaOuterStatic()
                         + o.localClass() + o.new Middle().deep().get());
    }
}
