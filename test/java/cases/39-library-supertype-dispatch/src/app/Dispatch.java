package app;

/**
 * HIERARCHY DISPATCH THROUGH A SUPERTYPE DECLARED IN A DEPENDENCY.
 *
 * Four structurally identical dispatch questions. The only difference between the two pairs is
 * WHERE the receiver's declared type is declared: `LocalStrategy`/`LocalTask` here, `dep.Strategy`/
 * `dep.Task` in the staged library. javac emits the same instruction for both — only the owner in
 * the constant pool differs — so the two must answer with the same shape: the declaration, plus
 * every client subtype declaring the member.
 *
 * NOTHING CONSTRUCTS THE IMPLEMENTORS. That is what separates this case from
 * 12-library-interface-override, where every implementor is allocated in the same compilation unit
 * and the site resolves by allocation-type flow rather than by hierarchy dispatch. This is the
 * injected shape — the implementation arrives from a container or a registry — and it is the one
 * that regressed: with the fan off a library-declared base disabled, viaExternal/viaTask stopped
 * at the library declaration and `ExtImplA#run` was the target of no edge at all, an unreachable
 * root in the graph.
 *
 * REVERT CHECK: disable the library-base clause in resolution/virtual-dispatch.dl and the four
 * `Dispatch#viaExternal -> ExtImpl*#run` / `Dispatch#viaTask -> ExtSub*#run` edges disappear from
 * the golden while the four client-declared ones stay — which is exactly the asymmetry the case
 * exists to forbid.
 */
public class Dispatch {

    // client-declared supertype — the control
    static String viaLocal(LocalStrategy x) { return x.run(); }
    static String viaLocalTask(LocalTask x) { return x.run(); }

    // library-declared supertype — the same question across the boundary
    static String viaExternal(dep.Strategy x) { return x.run(); }
    static String viaTask(dep.Task x)         { return x.run(); }
}
