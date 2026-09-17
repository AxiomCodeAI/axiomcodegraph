// HALF TWO — value tuples and deconstruction. No Java analogue for either.
//
// Three separate things share the `(a, b)` syntax and they are NOT the same
// construct:
//   1. a TUPLE TYPE  `(int Id, string Name) x`     — a type reference
//   2. a TUPLE LITERAL `(1, "n")`                  — an expression
//   3. a DECONSTRUCTION `(var a, var b) = source`  — an assignment that calls
//      a Deconstruct method, or reads tuple elements, and writes N targets
//
// Element NAMES are metadata only: `(int Id, string Name)` and `(int, string)`
// are the SAME runtime type, so a name is a fact about the reference and not
// about the value. An engine keyed on the name loses nothing; one that assumes
// the name is part of the identity gets two types where there is one.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Fixtures.CSharpOnly.Tuples;

public sealed class Customer
{
    public required int Id { get; init; }

    public required string Name { get; init; }

    public required string Country { get; init; }

    // A hand-written Deconstruct, which is what makes positional patterns and
    // deconstructing assignment available on a non-record.
    public void Deconstruct(out int id, out string name)
    {
        id = Id;
        name = Name;
    }

    // OVERLOADED Deconstruct: arity selects which one runs, exactly like an
    // ordinary overload, and the call site is a tuple shape rather than an
    // argument list.
    public void Deconstruct(out int id, out string name, out string country)
    {
        id = Id;
        name = Name;
        country = Country;
    }
}

public static class DeconstructExtensions
{
    // Deconstruct supplied as an EXTENSION METHOD, so a type declared in
    // another assembly becomes deconstructible. The call site names neither the
    // extension nor its class.
    public static void Deconstruct(this DateTime value, out int year, out int month, out int day)
    {
        year = value.Year;
        month = value.Month;
        day = value.Day;
    }
}

public class TupleForms
{
    // Tuple TYPES in every reference position.
    public (int, string) Unnamed;

    public (int Id, string Name) Named { get; set; }

    public (int Id, (string First, string Last) Name) Nested;

    public List<(int Id, string Name)> InGeneric = new();

    public Dictionary<(int, int), string> AsKey = new();

    public (int Id, string Name)[] AsArray = Array.Empty<(int, string)>();

    public (int Id, string Name)? Nullable;

    public Func<(int, string), (string, int)> AsDelegate = t => (t.Item2, t.Item1);

    // Eight or more elements: the compiler nests a TRest and the syntax hides
    // it. `NineElements.Item8` does not exist; `NineElements.H` does.
    public (int A, int B, int C, int D, int E, int F, int G, int H, int I) NineElements;

    // Tuple LITERALS.
    public void Literals()
    {
        var unnamed = (1, "n");
        var named = (Id: 1, Name: "n");
        var mixed = (1, Name: "n");

        // Names INFERRED from the expression (C# 7.1): `x.Id` becomes `Id`.
        var customer = new Customer { Id = 1, Name = "n", Country = "GB" };
        var inferred = (customer.Id, customer.Name);
        int viaInferredName = inferred.Id;

        // A local's name is inferred too.
        int id = 1;
        string name = "n";
        var fromLocals = (id, name);

        // Nested literals, a literal of literals, and a literal containing a
        // call, a lambda and a query.
        var nested = (Outer: 1, Inner: (A: 2, B: 3));
        var withCall = (Length: name.Length, Upper: name.ToUpperInvariant());
        var withLambda = (Project: (Func<int, int>)(x => x + 1), Seed: 1);

        // Default and explicit-typed literals.
        (int, string) explicitlyTyped = (1, "n");
        (int Id, string Name) withNames = default;

        // Tuple equality (C# 7.3): compares ELEMENTWISE, ignores names, and
        // applies conversions between element types.
        bool equal = unnamed == (1, "n");
        bool notEqual = named != (2, "m");
        bool acrossNames = named == unnamed;
        bool withConversion = (1, 2L) == (1L, 2);

        _ = viaInferredName + fromLocals.id + nested.Inner.A + withCall.Length
            + withLambda.Project(1) + explicitlyTyped.Item1 + withNames.Id
            + (equal ? 1 : 0) + (notEqual ? 1 : 0) + (acrossNames ? 1 : 0)
            + (withConversion ? 1 : 0) + mixed.Item1;
    }

    // Element ACCESS: by name, by ItemN, and both on the same value — because
    // the names are metadata, ItemN always works.
    public int ElementAccess((int Id, string Name) value)
    {
        int byName = value.Id;
        int byPosition = value.Item1;
        string nameByName = value.Name;
        string nameByPosition = value.Item2;

        // On a nine-element tuple, the ninth is reachable by name and by
        // `Rest.Item2` and NOT by `Item9`.
        int deep = NineElements.I;
        int deepByRest = NineElements.Rest.Item2;

        return byName + byPosition + nameByName.Length + nameByPosition.Length + deep + deepByRest;
    }

    // DECONSTRUCTION: into new locals, into existing ones, mixed, with
    // discards, nested, in a foreach, and from a method with an overloaded
    // Deconstruct.
    public int Deconstruction(Customer customer, IEnumerable<(int, string)> pairs, DateTime when)
    {
        // Into new locals with `var` distributed, and with `var` factored out.
        (var a, var b) = (1, "n");
        var (c, d) = (2, "m");

        // With explicit types, and with a mix of explicit and inferred.
        (int e, string f) = (3, "o");
        (int g, var h) = (4, "p");

        // Into EXISTING variables — an assignment, not a declaration.
        int i;
        string j;
        (i, j) = (5, "q");

        // Mixed declaration and assignment is NOT legal in one deconstruction
        // before C# 12's... it is not legal at all; recorded, not simulated.

        // With DISCARDS in each position.
        (_, string k) = (6, "r");
        (int l, _) = (7, "s");
        (_, _) = (8, "t");

        // NESTED deconstruction, two levels.
        (int m, (string n, int o)) = (9, ("u", 10));
        var (p, (q, r)) = (11, ("v", 12));

        // From a type with a hand-written Deconstruct, at both arities.
        var (id2, name2) = customer;
        var (id3, name3, country3) = customer;

        // From an EXTENSION Deconstruct on a BCL type.
        var (year, month, day) = when;

        // In a foreach, over tuples and over KeyValuePairs.
        int total = 0;
        foreach (var (first, second) in pairs)
        {
            total += first + second.Length;
        }

        foreach (var (key, value) in new Dictionary<string, int> { ["a"] = 1 })
        {
            total += key.Length + value;
        }

        // In a LINQ lambda parameter position — which is NOT deconstruction:
        // a lambda cannot deconstruct its parameter, so the element is named.
        total += pairs.Select(pair => pair.Item1).Sum();

        // The SWAP idiom, which is a deconstruction of a literal built from the
        // two targets.
        int x = 1, y = 2;
        (x, y) = (y, x);

        return a + b.Length + c + d.Length + e + f.Length + g + h.Length + i + j.Length
            + k.Length + l + m + n.Length + o + p + q.Length + r + id2 + name2.Length
            + id3 + name3.Length + country3.Length + year + month + day + total + x + y;
    }

    // Tuples as RETURN values — the multiple-return-value idiom that replaces
    // `out` in modern C#, and the direct competitor to the TryParse shape.
    public (int Min, int Max) MinMax(IEnumerable<int> source)
    {
        int min = int.MaxValue;
        int max = int.MinValue;
        foreach (int value in source)
        {
            min = Math.Min(min, value);
            max = Math.Max(max, value);
        }

        return (min, max);
    }

    public (bool Success, int Value, string? Error) TryParse(string text) =>
        int.TryParse(text, out int value) ? (true, value, null) : (false, 0, "bad");

    public async System.Threading.Tasks.Task<(int Count, string Summary)> AsyncTuple()
    {
        await System.Threading.Tasks.Task.Yield();
        return (1, "one");
    }

    public IEnumerable<(int Index, string Value)> IteratorOfTuples(IEnumerable<string> source)
    {
        int index = 0;
        foreach (string value in source)
        {
            yield return (index++, value);
        }
    }

    public void CallSitesForTupleReturns(IEnumerable<int> source)
    {
        // Deconstructing the return directly.
        var (min, max) = MinMax(source);

        // Keeping it whole and reading by name.
        var range = MinMax(source);
        int width = range.Max - range.Min;

        // Deconstructing with a discard.
        var (_, onlyMax) = MinMax(source);

        // Deconstructing a tuple returned from a Try-shaped method, which is
        // the same information as the out-parameter form in
        // ../parameters/TryParseShape.cs.
        if (TryParse("42") is (true, var parsed, _))
        {
            Console.WriteLine(parsed);
        }

        var (success, value, error) = TryParse("x");

        _ = min + max + width + onlyMax + (success ? value : error!.Length);
    }
}
