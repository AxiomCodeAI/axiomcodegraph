// CS-CORPUS-24: a preprocessor directive (`#pragma`) BETWEEN two operands of one
// expression. Everything after the directive, to the end of the expression,
// produces no rows: no BINARY for the `&&`, no call on its right-hand side.
// The sibling of CS-CORPUS-15 (`#if` splitting an expression body), which is fixed.
// Measured at cs-impl@f42baba.
using System.Collections.Generic;
using System.Linq;
namespace Fixtures.WalkGaps;

public class DirectiveInsideAnExpression
{
    // GAP: `#pragma` between the operands of `&&` inside a lambda argument — IndexOf is lost.
    public static IEnumerable<string> PragmaBetweenOperands(IEnumerable<string> a)
        => a.Where(
#pragma warning disable CS0618
                s => s.StartsWith("x")
#pragma warning restore CS0618
                     && s.IndexOf(':') > 0)
            .Select(s => "U" + s[(2 - 1)..]);

    // GAP: `#pragma` before the second arm of a conditional — both calls on the line after it are lost.
    public static object PragmaBeforeAnArm(bool flag, string s)
        => flag
            ? s.Length
#pragma warning disable CS0618
            : new List<string>(s.Split(',')).Count(x => x.Length > 0);
#pragma warning restore CS0618

    // GAP: `#pragma` between a `&&` chain's operands in a method body statement.
    public static bool PragmaInAStatement(string s, string t)
    {
        return s.StartsWith("x")
#pragma warning disable CS0618
            && !t.EndsWith("y");
#pragma warning restore CS0618
    }

    // CONTROL: the same expression with the directives outside it.
#pragma warning disable CS0618
    public static IEnumerable<string> Control(IEnumerable<string> a)
        => a.Where(s => s.StartsWith("x") && s.IndexOf(':') > 0)
            .Select(s => "U" + s[(2 - 1)..]);
#pragma warning restore CS0618
}
