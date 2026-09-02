package probe;

/**
 * The CHA fan matches a candidate override on (name, parameterCount). An override has, by
 * definition, the SAME erased parameter types as the method it overrides, so a candidate whose
 * parameter types differ cannot be an override at all — no receiver can ever dispatch to it.
 *
 * Three existing layers already remove most bad pairs and none of them catches this one:
 *   * override-shadowing (method-lookup.dl) hides an inherited ABSTRACT declaration, not a
 *     sibling concrete overload;
 *   * the receiver-subtype gate (callee-resolution.dl FIX-10) keeps Impl#put because Impl IS in
 *     Base's subtype closure;
 *   * argument applicability (overload.dl) cannot separate two REFERENCE parameters when the
 *     argument's own type resolves to neither.
 *
 * Parameter types are client-declared here on purpose: this suite stages no library IR, so a
 * library-typed parameter resolves to nothing and no comparison is possible.
 */
public class DispatchParams {

    static class Alpha { }
    static class Beta  { }

    static class Base {
        void put(Alpha a) { }                  // the real target of b.put(alpha)
    }

    static class Impl extends Base {
        void put(Beta b) { }                   // same name, same arity, INCOMPATIBLE type
    }

    /** must be exactly Base#put(Alpha) — Impl#put(Beta) is unreachable from any receiver */
    void direct(Base b, Alpha a) { b.put(a); }

    /** the sibling overload is still reachable on the type that declares it */
    void onImpl(Impl i, Beta b) { i.put(b); }

    public static void main(String[] args) {
        DispatchParams d = new DispatchParams();
        d.direct(new Impl(), new Alpha());
        d.onImpl(new Impl(), new Beta());
    }
}
