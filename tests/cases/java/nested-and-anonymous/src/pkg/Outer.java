package pkg;
import java.util.Iterator;
public class Outer {
    static class Inner {
        String label() { return "inner"; }
    }
    Iterator<String> first() {
        return new Iterator<String>() {
            public boolean hasNext() { return false; }
            public String next() { return "a"; }
        };
    }
    Runnable second() {
        return new Runnable() {
            public void run() { }
        };
    }
    String use() { return new Inner().label(); }
}
