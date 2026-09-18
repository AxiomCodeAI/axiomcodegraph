// The mirror of ../proj-nullable-project-enable/Overrides.cs: a file that turns
// the feature ON where the project turned it off, and then restores.
#nullable enable

using System;

namespace Fixtures.NullableDisable;

public class EnablesItself
{
    public string Required { get; set; } = string.Empty;

    public string? Optional { get; set; }

    public int Length(string? input) => input?.Length ?? 0;
}

#nullable restore

// After `restore` the project default is back in force, and the project default
// here is DISABLE — so this class is oblivious again while the one above is not,
// in the same file.
public class BackToDisabled
{
    public string Oblivious { get; set; }

    public string Echo(string input) => input;
}
