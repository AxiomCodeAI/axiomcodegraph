// Part 32 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity32 = new Dictionary<string, object>();

    /// <summary>Configures entity type 32.</summary>
    private void Configure32()
    {
        entity32["name"] = "Entity32";
        entity32["ordinal"] = 32;
        Register("Entity32", entity32);
    }

    public IReadOnlyDictionary<string, object> Entity32 => entity32;
}
