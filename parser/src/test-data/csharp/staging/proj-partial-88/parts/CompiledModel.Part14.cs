// Part 14 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity14 = new Dictionary<string, object>();

    /// <summary>Configures entity type 14.</summary>
    private void Configure14()
    {
        entity14["name"] = "Entity14";
        entity14["ordinal"] = 14;
        Register("Entity14", entity14);
    }

    public IReadOnlyDictionary<string, object> Entity14 => entity14;
}
