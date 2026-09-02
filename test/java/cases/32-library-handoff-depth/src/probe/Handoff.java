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
 * A receiver at depth ONE is deliberately NOT exercised here. It returns a WRONG target rather
 * than none — the same "an overload is not an override" mistake in method-lookup.dl's
 * DECLARED-WINS rule, which removes the inherited write(String) from the candidate set before
 * resolution ever sees it. That is a separate mechanism with a separate fix, and pinning the
 * current answer here would freeze a wrong one as the specification.
 */
public class Handoff {

    void atDepth0(Sink s)     { s.write("x"); }   // declared on the receiver's own type
    void atDepth2(FileSink s) { s.write("x"); }   // two hops up — the edge that vanished

    /** the sibling overload is still reachable where it is declared */
    void siblingOverload(BufferedSink s) { s.write(3); }
}
