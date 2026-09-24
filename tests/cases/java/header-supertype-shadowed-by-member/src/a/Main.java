package a;

public class Main {
    static Object run(Builder<?> x) { return x.build(); }

    public static void main(String[] args) {
        run(new PlainImpl());
        run(new DiffLike<String>());
    }
}
