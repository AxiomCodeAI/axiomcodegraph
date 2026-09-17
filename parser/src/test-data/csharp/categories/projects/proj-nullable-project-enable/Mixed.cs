// THE CONTEXT CHANGES FOUR TIMES IN ONE FILE.
//
// `#nullable` takes three settings — enable, disable, restore — and two
// independent targets — annotations and warnings. `restore` returns to the
// PROJECT default, which here is `enable`. A parser that records one nullable
// context per file is wrong for every region below except the first.
//
// The regions, in order:
//   1. lines below `#nullable disable`  -> disabled
//   2. lines below `#nullable enable`   -> enabled
//   3. lines below `#nullable restore`  -> the project default, enable
//   4. lines below `#nullable disable annotations` -> annotations off,
//      warnings still on: an unannotated type is oblivious but flow analysis
//      still runs
//   5. lines below `#nullable enable annotations` -> annotations on again
using System;

#nullable disable

namespace Fixtures.NullableEnable;

public class Region1Disabled
{
    // Oblivious. No CS8618 for the unassigned property.
    public string Value { get; set; }

    public string Echo(string input) => input.ToUpperInvariant();
}

#nullable enable

public class Region2Enabled
{
    // Non-nullable and unassigned: CS8618 fires here and not in Region1.
    public string Value { get; set; }

    public string? Optional { get; set; }

    public string Echo(string? input) => input?.ToUpperInvariant() ?? string.Empty;
}

#nullable restore

public class Region3Restored
{
    // `restore` means "whatever the .csproj said", which is enable — so this
    // class behaves like Region2, and would behave like Region1 in the sibling
    // project whose .csproj says disable. The SAME BYTES, different facts.
    public string Value { get; set; }

    public string? Optional { get; set; }
}

#nullable disable annotations

public class Region4AnnotationsOff
{
    // Annotations off, warnings on: `string` is oblivious again, but the flow
    // analysis that produces CS8602 still runs on values known to be null.
    public string Value { get; set; }

    public int Length(string input)
    {
        string? local = null;
        return (local ?? input).Length;
    }
}

#nullable enable annotations

public class Region5AnnotationsOn
{
    public string Value { get; set; }

    public string? Optional { get; set; }
}

#nullable disable warnings

public class Region6WarningsOff
{
    // Annotations still ON (so `string?` is meaningful and `string` is
    // non-nullable) but every nullable WARNING is suppressed. This is the
    // combination that makes "is nullable on here?" a two-bit answer rather
    // than a boolean.
    public string Value { get; set; }

    public string? Optional { get; set; }

    public int Unsafe(string? input) => input.Length;
}

#nullable restore

public class Region7RestoredAgain
{
    public string Value { get; set; }
}
