// CS-CORPUS-8. Tuple element expressions are never walked.
//
// Corroborated from the enum side: CsEdgeRole.TUPLE_ELEMENT is declared with
// zero rows across 12,054 corpus files, which is the same defect reached from
// the other direction.
using System;

namespace Fixtures.WalkGaps
{
    public class TupleElements
    {
        static int P() => 1;
        static int Q() => 2;

        // GAP: calls as tuple elements.
        public (int, int) Pair() => (P(), Q());

        // GAP: named tuple elements.
        public (int first, int second) NamedPair() => (first: P(), second: Q());

        // GAP: a tuple in a local declaration.
        public void Local() { var t = (P(), Q()); GC.KeepAlive(t); }

        // GAP: a tuple as an argument.
        static int Take((int, int) t) => 0;
        public int AsArgument() => Take((P(), Q()));

        // CONTROL: the same two calls, not in a tuple.
        public int NotATuple() => P() + Q();

        // CONTROL: deconstruction, which is a different construct and is
        // recorded by cs_variable.
        public void Deconstruct() { var (a, b) = (P(), Q()); GC.KeepAlive(a + b); }
    }
}
