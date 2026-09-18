// CS-CORPUS-3. The value of a NAMED argument is never walked. 13,880 call
// sites, 21.9% of all misses.
//
// cs_call_site.namedArgumentCount is CORRECT throughout, which is what makes
// this invisible to a count: the parser counts named arguments and does not
// descend into them.
using System;

namespace Fixtures.WalkGaps
{
    public class Conv { public Conv() { } }
    public class Outer { public class Inner { public Inner() { } } }

    public static class NamedArgumentValues
    {
        static int Sink(object? a = null, object? c = null) => 0;
        static int Id(object? o) => 0;

        public static void Cases()
        {
            // CONTROL: the identical expression, positionally. 2 of 2.
            Sink(typeof(NamedArgumentValues).GetProperty("X"));
            Sink(new Outer.Inner());

            // GAP: a call on a typeof receiver, as a named argument.
            Sink(a: typeof(NamedArgumentValues).GetProperty("X"));

            // GAP: an object creation as a named argument, simple name.
            Sink(a: new Conv());

            // GAP: an object creation as a named argument, qualified name.
            Sink(a: new Outer.Inner());

            // GAP: a plain call as a named argument.
            Sink(a: Id(null));

            // GAP: MIXED. The positional half is emitted and the named half is
            // not, on one line -- so a fix keyed on the call rather than on the
            // argument would still be wrong here.
            Sink(Id(null), c: Id(null));

            // GAP: nested two deep inside a named argument.
            Sink(a: new Conv[] { new Conv() });

            // CONTROL: a named argument whose value is a literal. Nothing to
            // lose, and it must stay at one row.
            Sink(a: 1);
        }
    }
}
