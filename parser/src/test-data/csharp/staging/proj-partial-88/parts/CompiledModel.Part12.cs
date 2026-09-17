// Part 12 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity12 = new Dictionary<string, object>();

    /// <summary>Configures entity type 12.</summary>
    private void Configure12()
    {
        entity12["name"] = "Entity12";
        entity12["ordinal"] = 12;
        Register("Entity12", entity12);
    }

    public IReadOnlyDictionary<string, object> Entity12 => entity12;
}
