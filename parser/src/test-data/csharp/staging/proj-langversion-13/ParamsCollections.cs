// HELD CONSTRUCT 2 of 4 — `params` COLLECTIONS (C# 13).
// NOT COMPILABLE IN THIS CHECKOUT. See ../NOT-VERIFIABLE-HERE.
//
// Until C# 13, `params` meant `params T[]` and nothing else, so every variadic
// call allocated an array. C# 13 allows any collection type a collection
// expression can target — `ReadOnlySpan<T>`, `Span<T>`, `List<T>`,
// `IEnumerable<T>`, `IReadOnlyList<T>` and a `[CollectionBuilder]` type — which
// makes the allocation optional and makes overload resolution between them a
// real question.
//
// The compiling `params T[]` forms are at ../ported/methods/ParameterAndReturnForms.cs.
using System;
using System.Collections;
using System.Collections.Generic;

namespace Fixtures.LangVersion13;

public static class ParamsCollections
{
    // The zero-allocation form, and the one the BCL moved to first.
    public static int SumSpan(params ReadOnlySpan<int> values)
    {
        int total = 0;
        foreach (int value in values)
        {
            total += value;
        }

        return total;
    }

    public static int SumMutableSpan(params Span<int> values) => values.Length;

    // The collection-interface forms.
    public static int CountEnumerable(params IEnumerable<string> values)
    {
        int count = 0;
        foreach (string _ in values)
        {
            count++;
        }

        return count;
    }

    public static int CountReadOnlyList(params IReadOnlyList<string> values) => values.Count;

    public static int CountCollection(params ICollection<string> values) => values.Count;

    public static int CountList(params List<string> values) => values.Count;

    // A `[CollectionBuilder]` type as a params target — the factory is named
    // nowhere at the call site, exactly as in a collection expression.
    public static int CountBag(params Bag<int> values) => values.Count;

    // params after a required parameter, and with a preceding optional one —
    // the position rule is unchanged.
    public static int Mixed(string first, int optional = 1, params ReadOnlySpan<int> rest) =>
        first.Length + optional + rest.Length;

    // OVERLOAD RESOLUTION between two params collections. C# 13 has a
    // preference order (span beats array beats interface), and nothing at the
    // call site says which was chosen.
    public static string Ambiguous(params ReadOnlySpan<int> values) => "span";

    public static string Ambiguous(params int[] values) => "array";

    public static string Ambiguous(params IEnumerable<int> values) => "enumerable";

    // On a constructor, an indexer, a delegate, a lambda and a local function.
    public delegate int Variadic(params ReadOnlySpan<int> values);

    public static int Elsewhere()
    {
        Variadic viaLambda = (params ReadOnlySpan<int> v) => v.Length;

        int Local(params ReadOnlySpan<int> v) => v.Length;

        var host = new VariadicHost(1, 2, 3);

        return viaLambda(1, 2) + Local(1, 2, 3) + host.Count + host[1, 2];
    }

    public static int CallSites()
    {
        // Expanded form: no array is allocated for the span overloads.
        int a = SumSpan(1, 2, 3);

        // Explicit collection-expression argument.
        int b = SumSpan([1, 2, 3]);

        // Explicit array argument, which still binds to the array overload.
        int c = SumSpan(new[] { 1, 2, 3 });

        // Empty.
        int d = SumSpan();

        string picksSpan = Ambiguous(1, 2);
        string picksArray = Ambiguous(new[] { 1, 2 });
        string picksEnumerable = Ambiguous((IEnumerable<int>)new[] { 1, 2 });

        int e = CountEnumerable("a", "b");
        int f = CountReadOnlyList("a");
        int g = CountList("a", "b", "c");
        int h = CountBag(1, 2);
        int i = Mixed("x", 2, 3, 4);

        return a + b + c + d + e + f + g + h + i
            + picksSpan.Length + picksArray.Length + picksEnumerable.Length + Elsewhere();
    }
}

public sealed class VariadicHost
{
    private readonly int[] items;

    public VariadicHost(params ReadOnlySpan<int> values) => items = values.ToArray();

    public int Count => items.Length;

    public int this[params ReadOnlySpan<int> indices] => indices.Length;
}

[System.Runtime.CompilerServices.CollectionBuilder(typeof(Bag), nameof(Bag.Create))]
public sealed class Bag<T> : IEnumerable<T>
{
    private readonly T[] items;

    public Bag(ReadOnlySpan<T> items) => this.items = items.ToArray();

    public int Count => items.Length;

    public IEnumerator<T> GetEnumerator() => ((IEnumerable<T>)items).GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

public static class Bag
{
    public static Bag<T> Create<T>(ReadOnlySpan<T> items) => new Bag<T>(items);
}
