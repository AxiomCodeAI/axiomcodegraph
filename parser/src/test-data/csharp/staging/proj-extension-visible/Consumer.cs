// THE VISIBLE TWIN. This file differs from proj-extension-hidden/Consumer.cs
// by exactly one line: the `using Acme.Text;` directive below.
//
// With it, `"a b".Slugify()` is a call to Acme.Text.StringExtensions.Slugify
// with the receiver passed as argument 0. Without it, the same eight bytes
// resolve to nothing. That is the fact the IR must carry: the parser does not
// decide visibility, but it must record the governing `using` set, the `this`
// parameter marker and the declaring static class, or the engine cannot
// reconstruct the edge.
using System;
using System.Collections.Generic;
using Acme.Text;

namespace Fixtures.ExtensionVisible;

public class Consumer
{
    public string CallsInExtensionSyntax(string input, int number, int? maybe, List<string> items)
    {
        string slug = input.Slugify();
        string truncated = input.Truncate(8);
        bool blank = input.IsBlank();
        IEnumerable<string> repeated = input.Repeat(3);
        string joined = items.JoinWith(",");
        bool even = number.IsEven();
        int zeroed = maybe.OrZero();

        // Chained: the receiver of the second call is the RESULT of the first.
        string chained = input.Slugify().Truncate(4).Slugify();

        // As an argument, in an interpolation, and inside a lambda.
        Consume(input.Slugify());
        string interpolated = $"{input.Slugify()}";
        Func<string, string> inLambda = s => s.Slugify();

        // On a null-conditional receiver.
        string? conditional = input?.Slugify();

        // On a literal receiver and on a `new` receiver.
        string onLiteral = "literal value".Slugify();
        string onNew = new string('a', 3).Slugify();

        return slug + truncated + blank + string.Join("", repeated) + joined
            + even + zeroed + chained + interpolated + inLambda(input)
            + conditional + onLiteral + onNew;
    }

    // The SAME methods called as ordinary static methods. These need the using
    // too — for the TYPE name rather than for extension lookup — and they are
    // the same call target reached by different syntax.
    public string CallsInStaticSyntax(string input, List<string> items)
    {
        string slug = StringExtensions.Slugify(input);
        string truncated = StringExtensions.Truncate(input, 8);
        string joined = StringExtensions.JoinWith(items, ",");
        return slug + truncated + joined;
    }

    // And once more fully qualified, which needs NO using at all.
    public string CallsFullyQualified(string input) =>
        global::Acme.Text.StringExtensions.Slugify(input);

    private static void Consume(string value)
    {
    }
}
