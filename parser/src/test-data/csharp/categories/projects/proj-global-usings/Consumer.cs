// THE AFFECTED FILE. There is not one `using` directive below this comment, and
// yet every name resolves — through the `global using` block in
// GlobalUsings.cs, a DIFFERENT FILE.
//
// This is the case that breaks a file-local import model: the import edge for
// `List<T>` in this module originates in another module of the same
// compilation, and no amount of reading this file will find it.
namespace Fixtures.GlobalUsings;

public class Consumer
{
    // Resolved by `global using System.Collections.Generic;`
    private readonly List<int> items = new List<int>();

    // Resolved by `global using Registry = ...;` — a GLOBAL ALIAS.
    private readonly Registry counts = new Registry();

    // Resolved by `global using Handler = System.Action<int>;`
    private Handler? handler;

    // Resolved by `global using System;`
    public DateTime Timestamp { get; set; }

    public void UsesGlobalStatics()
    {
        // `Sqrt` and `PI` — from `global using static System.Math;`
        double root = Sqrt(2.0);
        double half = PI / 2;

        // `IsNullOrEmpty` and `Join` — from `global using static System.String;`
        bool empty = IsNullOrEmpty(null);
        string joined = Join(",", items);

        // `Console` — from `global using System;`
        Console.WriteLine(joined);

        // LINQ — from `global using System.Linq;`. Every one of these is an
        // extension method made visible by a directive in another file.
        int total = items.Where(x => x > 0).Select(x => x * 2).Sum();
        List<int> ordered = items.OrderBy(x => x).ToList();

        counts["total"] = total;
        handler?.Invoke(ordered.Count);

        _ = root + half + (empty ? 1 : 0);
    }

    // A type from the declaring file, reached with no using because it is the
    // same namespace — so this file has two different reasons for resolving
    // names and neither is a directive it contains.
    public int FromSiblingFile() => new DeclaringFile().Length;
}
