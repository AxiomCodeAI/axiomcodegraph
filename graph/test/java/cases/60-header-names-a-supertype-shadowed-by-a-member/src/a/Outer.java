package a;

// The other direction: a member of an ENCLOSING type is in scope in a nested class's
// header, so Outer.Impl implements Outer.Builder, not a.Builder.
public class Outer {
    public interface Builder { Object build(); }

    public static class Impl implements Builder {
        @Override
        public Object build() { return this; }
    }
}
