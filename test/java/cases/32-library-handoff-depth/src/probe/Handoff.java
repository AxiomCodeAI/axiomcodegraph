package probe;

import dep.BufferedSink;
import dep.FileSink;
import dep.Sink;

/**
 * STUB LINKING: every client->library call must produce a boundary edge, whatever depth in the
 * LIBRARY's own hierarchy declares the target. This is one hop in the chain — the callee is
 * simply re-pointed to its declaring type, exactly as the bytecode oracle re-points it.
 *
 * `BufferedSink` declares write(int): same name, same arity, incompatible type. Keyed on
 * (name, arity) alone that looked like a NEARER declaration of Sink#write(String), so every
 * Sink-declared write was filtered out of the kept set while only BufferedSink's survived —
 * none of which overload resolution had selected. The site was classified resolved and emitted
 * nothing at all: no edge and no declared unknown.
 *
 * Depth 0 kept working throughout, which is why the pair is needed to localise the failure.
 *
 * All three depths must give the SAME answer, because the receiver expression and the argument
 * are the same in each; only the receiver's declared type moves down the hierarchy. Depth ONE is
 * the sharpest of the three: BufferedSink declares write(int), a same-arity SIBLING, and a
 * lookup keyed on (name, arity) alone treated that as a nearer declaration and removed the
 * inherited write(String) from the candidate set before resolution ever ran.
 */
public class Handoff {

    void atDepth0(Sink s)         { s.write("x"); }   // declared on the receiver's own type
    void atDepth1(BufferedSink s) { s.write("x"); }   // one hop up, past a same-arity sibling
    void atDepth2(FileSink s)     { s.write("x"); }   // two hops up

    /** the sibling overload is still reachable where it is declared */
    void siblingOverload(BufferedSink s) { s.write(3); }
}
