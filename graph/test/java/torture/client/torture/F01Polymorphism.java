package torture;

// f01 — POLYMORPHISM. Deep hierarchy, covariant return (javac emits a bridge), a diamond of
// interface defaults, an abstract base, and an overload set that arity alone cannot separate.

public class F01Polymorphism {

    interface Shape { double area(); default String tag() { return "shape"; } }
    interface Named { default String tag() { return "named"; } }
    // diamond: both supertypes declare tag(), so the class MUST declare it — and the call below
    // resolves to the class's own, never to either default.
    interface Both extends Shape, Named { @Override default String tag() { return "both"; } }

    static abstract class Base implements Shape {
        public abstract double area();
        public Base copy() { return this; }                 // covariant below -> bridge
        public String describe() { return tag() + ":" + area(); }
    }

    static class Square extends Base {
        private final double s;
        Square(double s) { this.s = s; }
        @Override public double area() { return s * s; }
        @Override public Square copy() { return new Square(s); }   // covariant: javac emits a bridge
    }

    static class Unit extends Square implements Both {
        Unit() { super(1); }
        @Override public double area() { return 1; }
    }

    // OVERLOAD SET the same arity cannot separate
    static String pick(Object o) { return "object"; }
    static String pick(String s) { return "string"; }
    static String pick(CharSequence c) { return "charseq"; }
    static String pick(int i) { return "int"; }
    static String pick(long l) { return "long"; }
    static String pick(Integer i) { return "boxed"; }

    // the receiver is the ABSTRACT base: a sound answer is the set of concrete overrides
    double viaBase(Base b) { return b.area(); }
    // the receiver is the INTERFACE: same question, one level wider
    double viaInterface(Shape s) { return s.area(); }
    // declared type is the base, allocated type is the leaf
    double viaAllocated() { Base b = new Unit(); return b.area(); }
    // covariant call: the source calls copy() on Square, bytecode goes through the bridge
    Square viaCovariant(Square q) { return q.copy(); }
    // the diamond: must be Both.tag, not Shape.tag or Named.tag
    String viaDiamond(Both b) { return b.tag(); }
    // inherited concrete method calling an abstract one on this
    String viaInherited(Square q) { return q.describe(); }

    String o1() { return pick("s"); }
    String o2() { return pick((Object) "s"); }
    String o3() { return pick(1); }
    String o4() { return pick(1L); }
    String o5() { return pick(Integer.valueOf(1)); }
    String o6(StringBuilder sb) { return pick(sb); }
}
