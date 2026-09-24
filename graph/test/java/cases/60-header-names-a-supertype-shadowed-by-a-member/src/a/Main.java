package a;

public class Main {
    static Object run(Builder<?> x) { return x.build(); }
    static String named(Base b) { return b.name(); }
    static Object outer(Outer.Builder b) { return b.build(); }

    public static void main(String[] args) {
        run(new PlainImpl());
        run(new DiffLike<String>());
        named(new Shape());
        outer(new Outer.Impl());
        DiffLike.make();
    }
}
