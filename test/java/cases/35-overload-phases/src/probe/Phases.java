package probe;

// JLS 15.12.2 decides applicability in THREE PHASES, and a later phase is entered only if the
// earlier one found nothing: phase 1 is strict (subtyping and widening primitive conversion),
// phase 2 adds boxing, phase 3 adds varargs. That ordering is not a specificity relation and
// cannot be recovered by ranking candidates — which is what made the two shapes below resolve to
// a WRONG target with known_edge status, the correct candidate absent from the set entirely.

public class Phases {

    // BOXING vs WIDENING. `long` is reachable in phase 1; `Integer` and `Object` need boxing, so
    // phase 2 is never entered. Unrankable: `long` and `Integer` are unordered by specificity.
    static String f(long l)    { return "long"; }
    static String f(Integer i) { return "Integer"; }
    static String f(Object o)  { return "Object"; }
    String boxingVsWidening() { return f(1); }              // f(long)

    // VARARGS LAST. `h(Object)` is reachable in phase 1; the varargs form is phase 3. Also
    // unrankable the other way: String[] really is more specific than Object, and the only reason
    // it loses is that phase 3 is never reached.
    static String h(Object o)    { return "one"; }
    static String h(String... a) { return "var"; }
    String varargsLast() { return h("a"); }                 // h(Object)

    // ... but an ARRAY argument does reach the varargs method, and must not be pruned by the gate.
    String varargsArray() { return h(new String[]{"a"}); }  // h(String[])

    // controls, which the gate must leave alone
    static String g(String s) { return "s"; }
    static String g(Object o) { return "o"; }
    String exactWins() { return g("a"); }                   // g(String)

    static String k(int i)  { return "i"; }
    static String k(long l) { return "l"; }
    String widenOnly() { return k(1); }                     // k(int)

    // an already-boxed argument: phase 1 admits Integer by identity and Object by subtyping,
    // and specificity then picks Integer. The primitive is NOT reachable — that needs unboxing.
    String boxedArg() { return f(Integer.valueOf(1)); }     // f(Integer)
}
