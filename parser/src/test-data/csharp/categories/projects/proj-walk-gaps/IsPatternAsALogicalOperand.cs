// CS-CORPUS-13. An `is` pattern as the LEFT operand of `&&` or `||` swallows
// the RIGHT operand: everything after it in the logical expression is dropped.
// `x is not null && x.M()` is one of the commonest idioms in modern
// nullable-aware C#.
//
// TWO discriminators, and both were written the other way round first and
// corrected on the measurement:
//
//   DIRECTION. `pattern && call` loses the call. `call && pattern` does NOT --
//   it is 1 of 1. So this is about the operand AFTER the pattern, not about
//   patterns appearing in a logical expression at all. That is the signature of
//   a right-hand operand read by CHILD INDEX, where the pattern node shifts the
//   index -- the same family as CS-CORPUS-5, where a comment did the shifting.
//
//   BINDING. A declaration pattern -- `o is string t` -- is fine. A null,
//   constant or bare type pattern with no binding is not.
//
// Every control below is a line this parser gets RIGHT. They are not decoration:
// without the `call && pattern` line the finding would have been filed as
// "an is pattern in a logical expression", which is a bigger and wronger claim.
using System;

namespace Fixtures.WalkGaps
{
    public class IsPatternAsALogicalOperand
    {
        static string? s = null;
        static object? o = null;
        static bool P(string x) => true;
        static int Q() => 1;

        public void Cases()
        {
            // CONTROL: `!= null` instead of a pattern. Correct.
            if (s != null && P(s)) { }

            // GAP: `is not null` on the left of &&. The call on the right is lost.
            if (s is not null && P(s)) { }

            // GAP: the same, with the call written on the narrowed value.
            if (s is not null && s.StartsWith("a")) { }

            // GAP: `is null` on the left of ||.
            if (s is null || P(s!)) { }

            // GAP: a chained call in the right operand. One invocation here --
            // `.Length` is a property, not a call -- and it is lost.
            if (s is not null && s.AsSpan().Length > 0) { }

            // CONTROL, and the one that makes this finding DIRECTIONAL: the
            // pattern on the RIGHT and the call on the left. 1 of 1, correct.
            if (P("x") && s is not null) { }

            // CONTROL: a DECLARATION pattern, which binds. Correct.
            if (o is string t && P(t)) { }

            // CONTROL: the pattern parenthesised under `!`. Correct.
            if (!(s is not null) && P("")) { }

            // CONTROL: a pattern as a ternary condition. Correct.
            var a = s is not null ? P(s) : false;

            // CONTROL: a pattern as a whole `if` condition, the call in the
            // body. Correct, and it is why this is about the OPERAND position
            // rather than about patterns at all.
            if (o is Action act) { act(); }

            // CONTROL: calls on both sides of && with no pattern anywhere.
            var b = Q() > 0 && P("y");
        }
    }
}
