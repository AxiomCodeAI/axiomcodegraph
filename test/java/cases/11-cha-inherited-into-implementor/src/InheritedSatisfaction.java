// CHA stressors that the receiver-subtype gate must get RIGHT, authored for this suite.
//
//  (a) INHERITED-INTO-IMPLEMENTOR: Impl satisfies Handler by INHERITING handle() from Base, and
//      Base is NOT a Handler subtype. The real dispatch target (Base.handle) is therefore declared
//      OUTSIDE Handler's hierarchy — a gate keyed on the DECLARING type wrongly drops it, a gate
//      keyed on reachability keeps it. This is the exact shape that made a strict gate lose ~30% of
//      the class-hierarchy dispatch set.
//  (b) super.m() is NON-VIRTUAL: `Child.run` calling `super.run()` names exactly Parent.run, and
//      must NOT fan back to Child.run (phantom self-recursion) nor to Sibling.run.
//  (c) a fan with several real implementors, so the sound dispatch set is genuinely > 1.
public class InheritedSatisfaction {

    interface Handler { String handle(String s); }

    static class Base {                                  // NOT a Handler
        public String handle(String s) { return "base:" + s; }
    }
    static class Impl extends Base implements Handler { } // satisfies Handler by INHERITANCE only

    static class Direct implements Handler {
        public String handle(String s) { return "direct:" + s; }
    }
    static class Another implements Handler {
        public String handle(String s) { return "another:" + s; }
    }

    static class Parent { void run() { } }
    static class Child extends Parent {
        @Override void run() { super.run(); }             // non-virtual: exactly Parent.run
    }
    static class Sibling extends Parent {
        @Override void run() { }
    }

    // (c) receiver typed as the interface: the sound set is {Base.handle (inherited into Impl),
    //     Direct.handle, Another.handle}
    String viaInterface(Handler h, String s) { return h.handle(s); }

    // exact receiver type: Java binds Base.handle through Impl, nothing else
    String viaImpl(Impl i, String s) { return i.handle(s); }

    void viaParent(Parent p) { p.run(); }                 // sound set: Parent/Child/Sibling.run

    public static void main(String[] a) {
        InheritedSatisfaction t = new InheritedSatisfaction();
        System.out.println(t.viaInterface(new Impl(), "x")
                         + t.viaInterface(new Direct(), "y")
                         + t.viaImpl(new Impl(), "z"));
        t.viaParent(new Child());
        t.viaParent(new Sibling());
    }
}
