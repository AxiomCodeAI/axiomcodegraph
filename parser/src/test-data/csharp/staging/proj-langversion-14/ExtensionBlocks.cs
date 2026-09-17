// C# 14 EXTENSION MEMBERS — `extension(T receiver) { … }` — NOT PARSED, NOT
// COMPILABLE HERE. See ../NOT-VERIFIABLE-HERE.
//
// The construct: a static class may declare an `extension` block naming a
// receiver, and the members inside it are extension members of that receiver
// type — instance properties and methods (which C# 13 could not express as
// extensions at all), static members, and operators. It is the successor to the
// `this`-parameter extension method, and the receiver is named ONCE for the
// whole block rather than on every method.
//
// WHAT THIS FILE MEASURES. The vendored grammar has no rule for the block, so
// it will not parse. What matters is how much of the file survives:
//
//   BeforeTheBlock  — must be recovered; if it is missing the file was not read
//   the block       — the gap; its byte count is the number
//   AfterTheBlock   — recovered only if the error is LOCAL; lost if it runs to
//                     end of file, as CS-CORPUS-29's did under fork11
//
// The construct is alone in a file and alone in a project so that the recovery
// is measured here and not absorbed into a neighbouring fixture's coverage.
//
// Written from the C# 14 language specification and NOT compile-verified: the
// SDK in this checkout stops at C# 12. If a form below is wrong, it is wrong in
// a way only the .NET 10 SDK can show, and the label says so.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Fixtures.LangVersion14;

/// <summary>Recovered under any grammar. Missing means the file was not read.</summary>
public sealed class BeforeTheBlock
{
    public int Value => 1;

    public string Describe() => "before";
}

public readonly record struct Vec(double X, double Y);

public static class Extensions
{
    // An extension block over `string`, with the receiver named once.
    extension(string source)
    {
        // An instance PROPERTY as an extension — impossible before C# 14.
        public bool IsBlank => string.IsNullOrWhiteSpace(source);

        public int WordCount => source.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;

        // An instance method, reading the receiver by its block-level name.
        public string Slug() => source.Trim().ToLowerInvariant().Replace(' ', '-');

        public string Truncate(int max) => source.Length <= max ? source : source[..max];
    }

    // A GENERIC extension block with a constraint.
    extension<T>(IEnumerable<T> source) where T : notnull
    {
        public T? FirstOrNull() => source.Any() ? source.First() : default;

        public bool IsEmpty => !source.Any();

        public IEnumerable<T> WhereNot(Func<T, bool> predicate) => source.Where(x => !predicate(x));
    }

    // A block naming only the receiver TYPE, for STATIC extension members:
    // `string.Combine(a, b)` becomes callable with no such member on string.
    extension(string)
    {
        public static string Combine(string a, string b) => a + b;

        public static string EmptyIfNull(string? value) => value ?? string.Empty;
    }

    // An OPERATOR as an extension member — the receiver type gains `+`.
    extension(Vec)
    {
        public static Vec operator +(Vec left, Vec right) => new Vec(left.X + right.X, left.Y + right.Y);

        public static Vec operator *(Vec v, double k) => new Vec(v.X * k, v.Y * k);
    }

    // A classic C# 3 `this`-parameter extension method in the SAME class, so
    // the old and new forms sit side by side and the grammar's boundary is
    // exactly between them.
    public static string Classic(this string source) => source + "!";
}

/// <summary>
/// Recovered ONLY if the error above is local. Its absence is the number.
/// </summary>
public sealed class AfterTheBlock
{
    public int Value => 2;

    public string Describe() => "after";

    public string Uses(string s, Vec a, Vec b)
    {
        // Call sites of extension members — the same syntax as instance members,
        // which is the whole point and the whole difficulty for a parser.
        bool blank = s.IsBlank;
        string slug = s.Slug();
        string combined = string.Combine(s, s);
        Vec sum = a + b;
        return $"{blank}{slug}{combined}{sum.X}{s.Classic()}";
    }
}
