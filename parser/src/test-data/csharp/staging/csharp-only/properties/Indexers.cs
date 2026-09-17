// HALF TWO — no Java analogue.
//
// An indexer IS a property with parameters: same accessor pair, same data
// location, but its name is `this` and it is invoked with `[]`. The schema
// carries it as `cs_property.isIndexer = true`, which is what makes an
// overloaded indexer a set of properties distinguished only by their parameter
// lists.
using System;
using System.Collections;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.Properties;

public class Indexers
{
    private readonly int[] byIndex = new int[16];
    private readonly Dictionary<string, int> byName = new();
    private readonly Dictionary<(int, int), int> byPair = new();

    // The canonical indexer.
    public int this[int index]
    {
        get => byIndex[index];
        set => byIndex[index] = value;
    }

    // OVERLOADED by parameter type — two indexers on one type.
    public int this[string key]
    {
        get => byName.TryGetValue(key, out int found) ? found : 0;
        set => byName[key] = value;
    }

    // OVERLOADED by arity.
    public int this[int row, int column]
    {
        get => byPair.TryGetValue((row, column), out int found) ? found : 0;
        set => byPair[(row, column)] = value;
    }

    // Expression-bodied indexer, get-only.
    public int this[double approximate] => byIndex[(int)approximate];

    // Indexer with an `init` accessor, with a default parameter value, and with
    // `params`.
    public int this[bool flag]
    {
        get => flag ? 1 : 0;
        init => byIndex[0] = value;
    }

    public int this[params int[] path]
    {
        get => path.Length;
    }

    // Split accessibility on an indexer.
    public int this[char key]
    {
        get => key;
        private set => byIndex[key % 16] = value;
    }

    // A generic indexer is impossible — an indexer cannot declare type
    // parameters — but its PARAMETER may be a constructed generic.
    public int this[List<int> keys] => keys.Count;

    // An indexer named something else via IndexerName: the metadata name
    // changes, the syntax does not.
    [System.Runtime.CompilerServices.IndexerName("Item")]
    public int this[Guid id] => id.GetHashCode();
}

// An indexer on an interface, on a struct, on a record and on an abstract class.
public interface IIndexed
{
    int this[int index] { get; set; }

    string this[string key] { get; }
}

public struct StructWithIndexer
{
    private int value;

    public int this[int index]
    {
        get => value;
        set => this.value = value;
    }
}

public readonly struct ReadOnlyStructWithIndexer
{
    private readonly int[] data;

    public ReadOnlyStructWithIndexer(int[] data) => this.data = data;

    public int this[int index] => data[index];
}

public record RecordWithIndexer(int[] Data)
{
    public int this[int index] => Data[index];
}

public abstract class AbstractIndexer
{
    public abstract int this[int index] { get; set; }

    public virtual int this[string key] => 0;
}

public class ConcreteIndexer : AbstractIndexer, IIndexed
{
    private readonly int[] data = new int[8];

    public override int this[int index]
    {
        get => data[index];
        set => data[index] = value;
    }

    public override int this[string key] => key.Length;

    // EXPLICIT INTERFACE indexer: no accessible name on the type at all.
    string IIndexed.this[string key] => key;
}

// Indexers on the BCL types that make `[]` mean five different things.
public class IndexerConsumers
{
    public void EveryBracketMeaning(
        Indexers custom,
        int[] array,
        int[,] rectangular,
        List<int> list,
        Dictionary<string, int> map,
        string text,
        Span<int> span,
        IIndexed viaInterface)
    {
        // A user-defined indexer: a CALL.
        int a = custom[0];
        custom[0] = 1;
        custom[0] += 1;

        int b = custom["key"];
        custom["key"] = 2;

        int c = custom[1, 2];
        custom[1, 2] = 3;

        int d = custom[1.5];
        int e = custom[new List<int> { 1 }];

        // An ARRAY element access: not a call, no user code, and the schema
        // must not conflate the two.
        int f = array[0];
        array[0] = 1;
        int g = rectangular[0, 1];

        // BCL indexers, which are calls into another assembly.
        int h = list[0];
        int i = map["k"];
        char j = text[0];
        int k = span[0];

        // Through an interface.
        int l = viaInterface[0];
        viaInterface[0] = 1;

        // Null-conditional element access.
        int? m = custom?[0];

        // Index-from-end and range on things that support them.
        char n = text[^1];
        string o = text[1..3];
        int p = array[^1];

        _ = a + b + c + d + e + f + g + h + i + j + k + l + (m ?? 0) + n + o.Length + p;
    }
}

// An indexer plus GetEnumerator makes a type usable in a collection
// initialiser, which is where indexer writes appear with no `[]` at the call
// site at all.
public class CollectionInitialisable : IEnumerable<int>
{
    private readonly List<int> items = new();

    public int this[int index]
    {
        get => items[index];
        set
        {
            while (items.Count <= index)
            {
                items.Add(0);
            }

            items[index] = value;
        }
    }

    public void Add(int item) => items.Add(item);

    public IEnumerator<int> GetEnumerator() => items.GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    // A collection initialiser calls Add(); an OBJECT initialiser with an
    // index writes the indexer's setter. The two spellings cannot be mixed in
    // one initialiser, and they compile to entirely different calls.
    public static CollectionInitialisable BuildByAdd() => new()
    {
        1,
        2
    };

    public static CollectionInitialisable BuildByIndexer() => new()
    {
        [5] = 9,
        [6] = 10
    };
}
