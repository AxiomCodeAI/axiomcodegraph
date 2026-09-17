// HALF TWO — COLLECTION EXPRESSIONS (C# 12), which the parse-layer measurement
// singled out: on tree-sitter-c-sharp 0.23.1 they are MANGLED WITHOUT AN ERROR,
// emitted as `element_binding_expression` with the spread as a
// `range_expression`, and `element_binding_expression` is OVERLOADED with the
// null-conditional index `a?[0]`. The injectivity allowlist exists because of
// this construct.
//
// So every disambiguation the allowlist names is exercised here, adjacently:
//   * a collection expression `[1, 2, 3]`
//   * a null-conditional element access `a?[0]`
//   * a real indexer call `dict[1, 2]`
//   * a range expression `1..3`
//   * a spread element `..other`
using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Linq;

namespace Fixtures.CSharpOnly.Collections;

public class CollectionExpressions
{
    // Every TARGET TYPE a collection expression can be converted to. The
    // expression is IDENTICAL in each; the target decides which constructor,
    // builder or factory runs. Nothing at the expression says which.
    public int[] ToArray() => [1, 2, 3];

    public List<int> ToList() => [1, 2, 3];

    public IEnumerable<int> ToEnumerable() => [1, 2, 3];

    public IReadOnlyList<int> ToReadOnlyList() => [1, 2, 3];

    public ICollection<int> ToCollection() => [1, 2, 3];

    public HashSet<int> ToSet() => [1, 2, 3];

    // A Span target is stack-allocated, so it may not ESCAPE the method
    // (CS9203) — the collection expression is legal as a local and illegal as
    // a return. One more case where the same expression's legality depends
    // entirely on its target.
    public int ToSpan()
    {
        Span<int> span = [1, 2, 3];
        ReadOnlySpan<char> chars = ['a', 'b'];
        return span[0] + chars.Length;
    }

    public ImmutableArray<int> ToImmutable() => [1, 2, 3];

    public int[][] Jagged() => [[1], [2, 3], []];

    public List<List<int>> NestedGeneric() => [[1], [2, 3]];

    // EMPTY, single-element, and trailing-comma forms.
    public int[] Empty() => [];

    public int[] Single() => [1];

    public int[] TrailingComma() => [1, 2, 3,];

    // SPREAD. `..` inside a collection expression is a spread element; `..`
    // between two expressions is a range. Both are below, adjacent.
    public int[] Spread(int[] first, int[] second) => [..first, ..second];

    public int[] SpreadMixed(int[] middle) => [0, ..middle, 99];

    public int[] SpreadOfQuery(IEnumerable<int> source) => [..source.Where(x => x > 0)];

    public int[] SpreadOfNested(int[][] rows) => [..rows[0], ..rows[1]];

    public List<string> SpreadOfDifferentType(IEnumerable<char> chars) =>
        [..chars.Select(c => c.ToString())];

    // RANGE expressions, which share the `..` token and mean something else.
    public int[] Ranges(int[] data)
    {
        int[] head = data[..3];
        int[] tail = data[3..];
        int[] middle = data[1..^1];
        int[] whole = data[..];
        Range range = 1..4;
        Index fromEnd = ^1;
        int[] viaRange = data[range];
        int last = data[fromEnd];
        return [..head, ..tail, ..middle, ..whole, ..viaRange, last];
    }

    // The two `[...]` shapes the grammar conflates, side by side and in the
    // same expression.
    public int Disambiguation(int[]? maybeArray, Dictionary<(int, int), int> byPair, List<int> list)
    {
        // A COLLECTION EXPRESSION.
        int[] collectionExpression = [1, 2, 3];

        // A NULL-CONDITIONAL ELEMENT ACCESS — the overloaded node type.
        int? conditional = maybeArray?[0];
        int? conditionalChained = maybeArray?[0..2]?.Length;

        // A REAL indexer call with two arguments.
        int fromIndexer = byPair[(1, 2)];

        // An ordinary element access.
        int fromList = list[0];

        // A collection expression as an ARGUMENT, which is the case the
        // measurement flagged as still broken on the unpatched fork:
        // "collection expression as a bare argument F([p])".
        int fromArgument = Sum([1, 2, 3]);
        int fromArgumentSpread = Sum([..collectionExpression, 4]);

        // A collection expression as a bare argument to a params method, and
        // to an overloaded one.
        int fromParams = Total([1, 2], [3, 4]);

        // A collection expression in a ternary, in an initialiser, in a return,
        // in a lambda body and in a switch arm.
        int[] fromTernary = list.Count > 0 ? [1] : [];
        var holder = new Holder { Values = [1, 2] };
        Func<int[]> fromLambda = () => [1, 2];
        int[] fromSwitch = list.Count switch { 0 => [], _ => [1] };

        // A collection expression nested inside a collection expression.
        int[][] nested = [[1, 2], [..collectionExpression]];

        return collectionExpression.Length + (conditional ?? 0) + (conditionalChained ?? 0)
            + fromIndexer + fromList + fromArgument + fromArgumentSpread + fromParams
            + fromTernary.Length + holder.Values.Length + fromLambda().Length
            + fromSwitch.Length + nested.Length;
    }

    private static int Sum(int[] values) => values.Sum();

    private static int Total(params int[][] rows) => rows.Sum(r => r.Sum());

    private sealed class Holder
    {
        public int[] Values { get; set; } = [];
    }

    // The OLD spellings, in the same file, so the pair is comparable: the same
    // collections built with `new[]`, an object initialiser, a collection
    // initialiser and a dictionary initialiser.
    public void OldSpellings()
    {
        int[] viaNew = new int[] { 1, 2, 3 };
        int[] viaInferredNew = new[] { 1, 2, 3 };
        List<int> viaCollectionInitialiser = new List<int> { 1, 2, 3 };
        List<int> viaTargetTypedNew = new() { 1, 2, 3 };
        Dictionary<string, int> viaDictionaryInitialiser = new() { ["a"] = 1 };
        Dictionary<string, int> viaAddInitialiser = new() { { "a", 1 } };
        var viaLinq = Enumerable.Range(1, 3).ToArray();

        _ = viaNew.Length + viaInferredNew.Length + viaCollectionInitialiser.Count
            + viaTargetTypedNew.Count + viaDictionaryInitialiser.Count
            + viaAddInitialiser.Count + viaLinq.Length;
    }

    // A type made constructible from a collection expression by
    // [CollectionBuilder] — the factory is a static method named nowhere at the
    // expression site.
    public Bag<int> ToCustomCollection() => [1, 2, 3];
}

[System.Runtime.CompilerServices.CollectionBuilder(typeof(Bag), nameof(Bag.Create))]
public sealed class Bag<T> : IEnumerable<T>
{
    private readonly T[] items;

    public Bag(ReadOnlySpan<T> items) => this.items = items.ToArray();

    public int Count => items.Length;

    public IEnumerator<T> GetEnumerator() => ((IEnumerable<T>)items).GetEnumerator();

    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
}

public static class Bag
{
    public static Bag<T> Create<T>(ReadOnlySpan<T> items) => new Bag<T>(items);
}
