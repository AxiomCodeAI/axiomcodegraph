// A FILE that overrides the project default. `#nullable disable` at the top of
// a file turns the whole file off, and the .csproj's `enable` no longer
// applies to a single line of it.
#nullable disable

using System;

namespace Fixtures.NullableEnable;

public class Overrides
{
    // In a DISABLED context an unannotated reference type is oblivious: it is
    // neither nullable nor non-nullable, and no warning is produced for
    // leaving it unassigned.
    public string Oblivious { get; set; }

    public string AlsoOblivious;

    public string Describe(string input)
    {
        // No warning: the context is off.
        return input.Length.ToString();
    }

    // `string?` in a DISABLED context is a warning (CS8632) — the annotation is
    // meaningless where the feature is off. That warning is the fixture: it is
    // how the oracle can prove the context was disabled at this line.
    public string? PointlessAnnotation { get; set; }
}
