// HALF TWO — interpolated, raw and UTF-8 string literals.
//
// An INTERPOLATED string is not a literal at all: it is an expression tree with
// holes, and each hole is arbitrary C# — a call, a lambda, a query, a nested
// interpolation. Every front end in this repo has lost calls inside a construct
// that emits no node of its own (`{t(msg)}` in JSX cost 4,488 of admin-ui's
// 14,335 call sites), and an interpolation hole is exactly that shape.
//
// A RAW string literal (C# 11) changes the LEXING rules mid-file: the delimiter
// length is variable, indentation is stripped relative to the closing quotes,
// and `$$"""` changes how many braces open a hole.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Fixtures.CSharpOnly.Strings;

public class StringLiterals
{
    private readonly string name = "world";
    private readonly int count = 3;
    private readonly List<int> items = new() { 1, 2, 3 };

    // Ordinary and verbatim literals, for contrast with everything below.
    public string Ordinary = "line1\nline2\ttab\\slash\"quote";

    public string Verbatim = @"C:\path\no\escapes ""doubled quotes""";

    public string VerbatimMultiline = @"first
second";

    // INTERPOLATED, simple.
    public string Simple() => $"hello {name}";

    public string SeveralHoles() => $"{name} has {count} items";

    // Holes containing every kind of expression.
    public string EveryHoleShape()
    {
        return $"literal {1 + 2}"
            + $"call {Compute()}"
            + $"member {name.Length}"
            + $"chain {name.Trim().ToUpperInvariant().Length}"
            + $"element {items[0]}"
            + $"ternary {(count > 0 ? "yes" : "no")}"
            + $"cast {(int)1.5}"
            + $"new {new StringBuilder().Length}"
            + $"lambda {((Func<int, int>)(x => x + 1))(1)}"
            + $"linq {items.Where(x => x > 1).Sum()}"
            + $"query {(from i in items where i > 1 select i).Count()}"
            + $"switch {count switch { 0 => "none", _ => "some" }}"
            + $"nullcoalesce {name ?? "fallback"}"
            + $"conditional {name?.Length ?? 0}"
            + $"await-free-task {System.Threading.Tasks.Task.FromResult(1).Result}"
            + $"nameof {nameof(EveryHoleShape)}"
            + $"typeof {typeof(StringLiterals).Name}";
    }

    private int Compute() => 42;

    // NESTED interpolation: a hole containing another interpolated string,
    // three deep.
    public string Nested() => $"outer {$"middle {$"inner {name}"}"}";

    // ALIGNMENT and FORMAT specifiers, which are part of the interpolation
    // syntax and not of the expression.
    public string Formatted(decimal total, DateTime when) =>
        $"{total,10:C2} on {when:yyyy-MM-dd} at {when,-8:HH:mm} [{count,3}]";

    // A colon inside a hole must be parenthesised or it reads as a format
    // specifier — a genuine lexing trap.
    public string ColonTrap(bool flag) => $"{(flag ? 1 : 2)}";

    // Braces escaped by doubling.
    public string EscapedBraces() => $"{{literal braces}} and a hole {count}";

    // VERBATIM INTERPOLATED, in both orders — `$@` and `@$` are both legal.
    public string VerbatimInterpolated() => $@"C:\dir\{name}\file";

    public string VerbatimInterpolatedOtherOrder() => @$"C:\dir\{name}\file";

    public string VerbatimInterpolatedMultiline() => $@"first {name}
second {count}";

    // FormattableString and IFormattable: the same syntax producing a DIFFERENT
    // TYPE, chosen by the target. Nothing in the interpolation says which.
    public FormattableString AsFormattable() => $"{count} items for {name}";

    public string WithCulture() =>
        FormattableString.Invariant($"{1234.5:N2}");

    public string WithExplicitCulture() =>
        ((FormattableString)$"{1234.5:N2}").ToString(CultureInfo.InvariantCulture);

    // RAW STRING LITERALS (C# 11). Three quotes minimum, more if the content
    // contains three.
    public string RawSingleLine() => """no \escapes and "quotes" are fine""";

    public string RawWithMoreQuotes() => """"contains """ three quotes"""";

    public string RawMultiline() => """
        The indentation of the CLOSING delimiter is stripped from every line,
        so this text has no leading spaces at all.
            This line keeps four, because it is indented further.
        """;

    public string RawJson() => """
        {
          "name": "value",
          "nested": { "a": [1, 2, 3] }
        }
        """;

    // RAW INTERPOLATED: `$"""` — one brace opens a hole.
    public string RawInterpolated() => $"""
        Hello {name}, you have {count} items.
        A raw interpolated string has NO doubling escape: with one '$' a single
        brace always opens a hole, so a literal brace needs the $$ form below.
        """;

    // `$$"""` — TWO braces open a hole, so single braces are literal. This is
    // the shape that makes JSON templates readable and it changes the meaning
    // of every brace in the literal.
    public string RawDoubleDollar() => $$"""
        {
          "name": "{{name}}",
          "count": {{count}},
          "literal": { "not": "a hole" }
        }
        """;

    public string RawTripleDollar() => $$$"""
        {{{name}}} needs three braces; {{ }} and { } are both literal.
        """;

    // UTF-8 string literals (C# 11): the suffix changes the TYPE to
    // ReadOnlySpan<byte>, not string. A literal whose type is not string.
    public ReadOnlySpan<byte> Utf8() => "hello"u8;

    public ReadOnlySpan<byte> Utf8Verbatim() => @"C:\path"u8;

    public byte[] Utf8Array() => "hello"u8.ToArray();

    // Concatenation of adjacent literals, of a literal and a const, and of an
    // interpolation with a literal — the first two are folded at compile time
    // and the third is not.
    public const string Prefix = "cfg";

    public const string Folded = Prefix + "." + "enabled";

    public string NotFolded() => Prefix + "." + name;

    public string MixedConcat() => "a" + $"{count}" + @"b" + """c""";

    // String.Format and the interpolation that replaces it, side by side.
    public string ViaFormat() => string.Format("{0} has {1} items", name, count);

    public string ViaInterpolation() => $"{name} has {count} items";

    // An interpolated string handler target (C# 10): the same syntax compiled
    // into AppendLiteral/AppendFormatted calls instead of a string, chosen by
    // the parameter's type.
    public void ViaHandler()
    {
        var builder = new StringBuilder();
        builder.Append($"{name} has {count} items");

        System.Diagnostics.Debug.Assert(count > 0, $"count was {count}");
    }
}
