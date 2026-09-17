// A FILE WITH NO NAMESPACE AT ALL.
//
// Closing a coverage hole found by running cs-impl's enum audit against this
// corpus: `CsNamespaceStyle.NONE` was declared and unreached. Every file here
// had either a file-scoped namespace or a block one, and the file that did
// declare a global-namespace TYPE (namespaces/BlockNamespaces.cs) also declares
// block namespaces, so its module reads BLOCK or MIXED and never NONE.
//
// A namespace-less file is not a curiosity. It is what `Program.cs` looks like
// in a script-shaped project, what a lot of 2010-era C# looks like, and what
// every file in a single-assembly tool looks like. Its types live in the global
// namespace and are reachable only by their short name or by `global::`.
//
// It lives in type-registry/ rather than at the top of ported/ because the one
// namespaced type it reaches, `Fixtures.Ported.TypeRegistry.PlainClass`, is
// declared there — and `categories/` is canonical, where every category is its
// own project and no reference may cross one. Where a file sits is part of
// what it depends on.
//
// There is no `using` in this file either, so `System` is not in scope and
// everything is written out. That is deliberate: it keeps the module's `using`
// set empty, which is the other half of what NONE means in practice.

/// <summary>A type in the global namespace.</summary>
public class GlobalNamespaceType
{
    public int Value => 1;

    // Fully qualified, because nothing is imported.
    public System.DateTime Timestamp { get; set; }

    public System.Collections.Generic.List<int> Items { get; } =
        new System.Collections.Generic.List<int>();

    // Reaching a NAMESPACED type from the global namespace.
    public Fixtures.Ported.TypeRegistry.PlainClass Namespaced { get; } =
        new Fixtures.Ported.TypeRegistry.PlainClass();

    public int Total() => Value + Items.Count + Timestamp.Year;
}

/// <summary>A second global-namespace type, so the file is not a singleton.</summary>
internal interface IGlobalNamespaceInterface
{
    int Value { get; }
}

internal enum GlobalNamespaceEnum
{
    First,
    Second,
}

internal readonly struct GlobalNamespaceStruct
{
    public GlobalNamespaceStruct(int value) => Value = value;

    public int Value { get; }
}

internal delegate int GlobalNamespaceDelegate(int value);

internal record GlobalNamespaceRecord(int Id, string Name);
