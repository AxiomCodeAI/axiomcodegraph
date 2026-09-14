// Language surface that dispatch has to cope with: enum constant bodies, records, sealed
// hierarchies with pattern switches, and interface default/static methods.
public class LangFeatures {

    // (a) ENUM with an abstract method and per-constant bodies — the constant bodies are
    //     overrides that no subtype declares, so CHA has to reach them specially.
    enum Op {
        ADD { @Override int apply(int a, int b) { return plus(a, b); } },
        MUL { @Override int apply(int a, int b) { return times(a, b); } };
        abstract int apply(int a, int b);
        static int plus(int a, int b)  { return a + b; }
        static int times(int a, int b) { return a * b; }
    }

    // (b) RECORD: canonical ctor, accessor, and an explicit method
    record Point(int x, int y) {
        int norm() { return abs(x) + abs(y); }
        static int abs(int v) { return v < 0 ? -v : v; }
    }

    // (c) SEALED hierarchy + pattern switch — the switch arms are the dispatch
    sealed interface Shape permits Circle, Square { double area(); }
    record Circle(double r) implements Shape { public double area() { return 3.14 * r * r; } }
    record Square(double s) implements Shape { public double area() { return s * s; } }

    // (d) interface with default AND static methods
    interface Greeter {
        String name();
        default String greet() { return "hi " + name(); }
        static Greeter of(String n) { return () -> n; }
    }

    int viaEnum(Op op)        { return op.apply(2, 3); }          // enum constant body dispatch
    int viaRecord(Point p)    { return p.norm() + p.x(); }        // record method + accessor
    double viaPattern(Shape s) {
        return switch (s) {                                        // pattern switch
            case Circle c -> c.area();
            case Square q -> q.area();
        };
    }
    String viaDefault(Greeter g) { return g.greet(); }             // default method -> name()

    public static void main(String[] a) {
        LangFeatures t = new LangFeatures();
        System.out.println(t.viaEnum(Op.ADD) + t.viaEnum(Op.MUL)
                         + t.viaRecord(new Point(-1, 2))
                         + t.viaPattern(new Circle(1)) + t.viaPattern(new Square(2))
                         + t.viaDefault(Greeter.of("x")));
    }
}
