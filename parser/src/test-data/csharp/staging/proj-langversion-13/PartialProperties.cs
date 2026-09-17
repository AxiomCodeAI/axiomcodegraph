// HELD CONSTRUCT 4 of 4 — PARTIAL PROPERTIES AND PARTIAL INDEXERS (C# 13).
// NOT COMPILABLE IN THIS CHECKOUT. See ../NOT-VERIFIABLE-HERE.
//
// This is the one of the four that changes the fact base's SHAPE rather than
// adding a column value, and it is the one the source-generator stratum needs
// most. Before C# 13 a generator could only supply a partial METHOD, so the
// MVVM-toolkit pattern had to generate a whole property from a field
// declaration. With partial properties the DEFINING declaration is written by
// hand and the IMPLEMENTING one is generated — which means:
//
//   * a `cs_property` row has a defining part and an implementing part, and
//     the schema's `isPartialDefinition` / `isPartialImplementation` split,
//     which currently exists only on `cs_method`, has no property analogue;
//   * the ACCESSORS are split with it, so the accessor `cs_method` rows that
//     §2.4 requires are generated in a file that is not on disk;
//   * `proj-partial-generated/`'s single-part shape now applies to properties.
//
// The compiling C# 12 equivalents are at ../csharp-only/partial/PartialMethods.cs
// (partial methods, both dialects) and the note there recording that partial
// properties are C# 13 and absent.
using System;
using System.Collections.Generic;

namespace Fixtures.LangVersion13;

public partial class ViewModel
{
    // DEFINING declarations: no body, no accessor bodies, `partial` on the
    // property. In a real project the file below is what a generator writes.
    public partial string Name { get; set; }

    public partial int Count { get; init; }

    public partial IReadOnlyList<string> Tags { get; }

    // A partial property with split accessibility.
    public partial string Slug { get; private set; }

    // A partial INDEXER — same rules, and its name is `this`.
    public partial string this[int index] { get; set; }

    // A partial property on a STATIC member and with an attribute.
    [Obsolete("use Name")]
    public static partial string Legacy { get; set; }

    // A method that consumes properties whose accessors are declared in
    // another file — the call sites a parser must still emit.
    public string Describe() => $"{Name}/{Count}/{Slug}/{this[0]}/{Tags.Count}";
}

public partial class ViewModel
{
    private string name = string.Empty;
    private int count;
    private string slug = string.Empty;
    private readonly List<string> tags = new();
    private static string legacy = string.Empty;

    // IMPLEMENTING declarations. The signature, including accessor set and
    // accessibility, must match the defining one exactly; only the bodies are
    // added.
    public partial string Name
    {
        get => name;
        set => name = value ?? string.Empty;
    }

    public partial int Count
    {
        get => count;
        init => count = value;
    }

    public partial IReadOnlyList<string> Tags => tags;

    public partial string Slug
    {
        get => slug;
        private set => slug = value.ToLowerInvariant();
    }

    public partial string this[int index]
    {
        get => tags[index];
        set => tags[index] = value;
    }

    public static partial string Legacy
    {
        get => legacy;
        set => legacy = value;
    }
}

// A partial property whose implementing half would be GENERATED — one part on
// disk, the accessor bodies nowhere the parser can read. This is the shape that
// makes partial properties matter, and the C# 12 stand-in for it
// (a generator-trigger attribute on a field) is at
// ../proj-noncompiling/GeneratorShapeWithoutGenerator.cs.
public partial class GeneratedHalf
{
    public partial string Bound { get; set; }
}
