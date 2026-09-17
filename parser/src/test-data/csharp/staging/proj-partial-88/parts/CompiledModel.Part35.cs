// Part 35 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity35 = new Dictionary<string, object>();

    /// <summary>Configures entity type 35.</summary>
    private void Configure35()
    {
        entity35["name"] = "Entity35";
        entity35["ordinal"] = 35;
        Register("Entity35", entity35);
    }

    public IReadOnlyDictionary<string, object> Entity35 => entity35;
}
