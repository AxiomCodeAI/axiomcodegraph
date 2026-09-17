// Part 15 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity15 = new Dictionary<string, object>();

    /// <summary>Configures entity type 15.</summary>
    private void Configure15()
    {
        entity15["name"] = "Entity15";
        entity15["ordinal"] = 15;
        Register("Entity15", entity15);
    }

    public IReadOnlyDictionary<string, object> Entity15 => entity15;
}
