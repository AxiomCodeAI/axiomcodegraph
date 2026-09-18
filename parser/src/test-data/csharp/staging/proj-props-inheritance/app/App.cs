// Every branch below is decided by a property whose value comes from a
// DIFFERENT FILE than the .csproj that owns this source file.
using System;
using System.Collections.Generic;

namespace Fixtures.PropsInheritance;

public class App
{
    // Compiles only because Nullable=enable arrived from Directory.Build.props.
    public string? Optional { get; set; }

    // Compiles only because ImplicitUsings=disable in the .csproj forced the
    // `using` lines above to be written explicitly. With ImplicitUsings=enable
    // they would be redundant, and the fact base would carry seven extra
    // IMPLICIT rows that no file mentions.
    private readonly List<int> items = new List<int>();

#if FROM_PROPS
    // Defined by the props file.
    public const string PropsBranch = "props";
#else
    public const string PropsBranch = "no-props";
#endif

#if FROM_CSPROJ
    // Defined by the .csproj, APPENDED to the props value rather than replacing
    // it. Both symbols are live at once, which only happens because the .csproj
    // wrote $(DefineConstants) into its own value.
    public const string CsprojBranch = "csproj";
#else
    public const string CsprojBranch = "no-csproj";
#endif

#if FROM_PROPS && FROM_CSPROJ
    public const string Both = "both";
#else
    public const string Both = "not-both";
#endif

    public string Describe() => $"{PropsBranch}/{CsprojBranch}/{Both}/{Optional}/{items.Count}";
}
