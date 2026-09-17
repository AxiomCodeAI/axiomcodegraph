// The third variant of the extension-visibility case, kept here rather than in
// ../proj-extension-hidden/ because that project is a matched PAIR and must
// stay byte-comparable. Here the extension is declared in the SAME PROJECT,
// in a namespace this file does not import — which is the mistake real code
// actually makes.
//
// Expected: CS1061 on every extension-syntax call.
using System;

namespace Fixtures.NonCompiling.Helpers
{
    public static class NumberExtensions
    {
        public static int Squared(this int value) => value * value;

        public static bool IsPositive(this int value) => value > 0;
    }
}

namespace Fixtures.NonCompiling
{
    public class ExtensionWithoutUsing
    {
        public int Uses(int value)
        {
            // CS1061 — the extension exists, in this assembly, and is not in
            // scope. Roslyn reports no candidate symbols at all for these,
            // which is DIFFERENT from an inaccessible member and different
            // again from a name that does not exist.
            return value.Squared() + (value.IsPositive() ? 1 : 0);
        }

        // The same calls in static syntax, which need only the type name and
        // therefore succeed with a qualified name.
        public int Qualified(int value) =>
            Helpers.NumberExtensions.Squared(value);
    }
}
