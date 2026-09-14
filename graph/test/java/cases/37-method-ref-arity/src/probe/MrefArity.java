package probe;

import fn.BiFn;
import fn.Fn;
import fn.Sink;
import fn.Sup;

/**
 * A method reference writes no arguments, so every same-name candidate used to survive —
 * including the ones the functional interface it is converted to cannot accept. The arity is
 * the arity of the target type's SAM (JLS 15.13.1).
 *
 * The +/-1 is the part that has to be right: only an UNBOUND reference (`Type::m` where m is an
 * instance method) spends the SAM's first parameter on the receiver. Getting it backwards keeps
 * the impossible candidate and drops the real one, which is why both directions are pinned here
 * and why the overload sets below differ ONLY in arity.
 */
public class MrefArity {

    String render(Object o) { return "1:" + o; }
    String render()         { return "0"; }

    static String sRender(Object o) { return "s1"; }
    static String sRender()         { return "s0"; }

    // ── BOUND: receiver supplied, so SAM arity == method arity ────────────────────
    Fn<Object, String> boundOne()  { return this::render; }   // SAM 1 -> render(Object)
    Sup<String>        boundZero() { return this::render; }   // SAM 0 -> render()

    // ── STATIC: no receiver is spent, so SAM arity == method arity ────────────────
    Fn<Object, String> staticOne()  { return MrefArity::sRender; }  // SAM 1 -> sRender(Object)
    Sup<String>        staticZero() { return MrefArity::sRender; }  // SAM 0 -> sRender()

    // ── UNBOUND: `Type::m` on an INSTANCE method — SAM's first parameter is the receiver ──
    Fn<MrefArity, String>           unboundZero() { return MrefArity::render; }  // SAM 1 -> render()
    BiFn<MrefArity, Object, String> unboundOne()  { return MrefArity::render; }  // SAM 2 -> render(Object)

    // ── ARGUMENT position: the target is the callee's parameter type ──────────────
    void inArgument(Sink s) {
        s.accept(this::render);      // SAM 1 -> render(Object)
        s.acceptSup(this::render);   // SAM 0 -> render()
    }

    // ── LOCAL and FIELD positions ─────────────────────────────────────────────────
    Fn<Object, String> asField = this::render;               // SAM 1 -> render(Object)

    String inLocal() {
        Sup<String> s = this::render;                        // SAM 0 -> render()
        return s.get();
    }

    // ── A CLIENT-declared functional interface resolves the same way ──────────────
    Own toOwn() { return this::render; }                     // SAM 1 -> render(Object)

    // ── VARARGS is never filtered: it satisfies more than one arity, and choosing
    //    between them is the three-phase question a call answers, not an arity test. ──
    String v(Object... xs) { return "v"; }
    String v(Object x)     { return "v1"; }

    Fn<Object, String> varargs() { return this::v; }
}
