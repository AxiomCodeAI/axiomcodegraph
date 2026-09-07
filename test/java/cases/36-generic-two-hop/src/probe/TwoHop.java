package probe;

import dep.Box;
import dep.Lookup;
import dep.Pair;

/**
 * Generic substitution across TWO library hops.
 *
 * One hop — a library generic's method returning its own type variable — already resolved.
 * A second hop, where the first method returns ANOTHER library generic parameterised by the
 * same variable, resolved only as a direct chain: parking the intermediate in a `var` local
 * lost the binding, because `var` writes no type reference of its own and nothing carried the
 * initializer's type arguments across to the local's uses.
 *
 * Every shape here is client -> library -> client: the element type is the client's own
 * Widget, so a resolved chain ends at probe.Widget#id() and an unresolved one is visible as a
 * declared unknown rather than as a missing row.
 */
public class TwoHop {

    static class Widget {
        String id() { return "w"; }
    }

    static Box<Widget> box() { return null; }

    /** ONE hop: Box<Widget>#get returns E. Already resolved; kept so a regression in the
     *  single-hop path is caught here too. */
    String oneHop() {
        return box().get(0).id();
    }

    /** ONE hop parked in a `var` local. Already resolved. */
    String oneHopVar() {
        var b = box();
        return b.get(0).id();
    }

    /** TWO hops as a direct chain: Box<Widget>#iterator -> Iter<E>, then Iter#next -> E.
     *  Already resolved — the binding propagates along the chain expression itself. */
    String twoHopChain() {
        return box().iterator().next().id();
    }

    /**
     * TWO hops with the intermediate parked in a `var` local. Previously a declared unknown.
     *
     * This is also the shape that constrains HOW the binding may be recorded. Keying it on
     * the callee's return-type REFERENCE resolves this method and is still wrong: a library
     * method has ONE return reference shared by every call site in the program, so a binding
     * inferred here is then read by every other caller of Box#iterator. Measured on a large
     * corpus, that retyped an unrelated String parameter as a List and silently lost the
     * correct `write(String,int,int)` overload at four call sites in another package. The
     * binding is therefore keyed per EXPRESSION, and this case pins the behaviour rather
     * than the mechanism, so a future reimplementation is free as long as it stays sound.
     */
    String twoHopVar() {
        var it = box().iterator();
        return it.next().id();
    }

    /** Both hops parked. Previously a declared unknown. */
    String twoHopBothVars() {
        var b = box();
        var it = b.iterator();
        return it.next().id();
    }

    /**
     * A NESTED type argument written by the CLIENT: Box<Pair<String,Widget>> parameterises
     * Box with a type carrying its own arguments, at depth 2 of a client reference. Already
     * resolved — kept because the library-side counterpart below is not, and the pair of
     * them is what localises the remaining gap.
     */
    static Box<Pair<String, Widget>> pairs() { return null; }

    String nestedArgOnClientRef() {
        return pairs().get(0).value().id();
    }

    /**
     * The same nesting written on the LIBRARY's own reference — NOT resolved, pinned as a
     * declared unknown so the gap is a visible golden line.
     *
     * Lookup<K,V>#entries() returns Box<Pair<K,V>>: the depth-1 argument is Pair, which binds
     * Box's element, but Pair's own K and V are type VARIABLES at depth 2 of a library
     * reference, and nothing substitutes the receiver's String/Widget into them. So `value()`
     * has no type and the call on it is a declared unknown. This is the shape that leaves
     * `for (var e : map.entrySet()) e.getValue()` unresolved against the real JDK.
     */
    static Lookup<String, Widget> lookup() { return null; }

    String nestedArgOnLibRef() {
        return lookup().entries().get(0).value().id();
    }
}
