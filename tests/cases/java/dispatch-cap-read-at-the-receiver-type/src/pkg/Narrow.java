package pkg;

// a narrower base with two implementations of its own
public abstract class Narrow implements Lookup {
    public static final class A extends Narrow { public String lookup(String k) { return "a"; } }
    public static final class B extends Narrow { public String lookup(String k) { return "b"; } }

    static String viaNarrow(Narrow n) { return n.lookup("x"); }
    static String viaWide(Lookup l) { return l.lookup("x"); }
}
