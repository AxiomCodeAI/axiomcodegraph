// Part 06 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity06 = new Dictionary<string, object>();

    /// <summary>Configures entity type 06.</summary>
    private void Configure06()
    {
        entity06["name"] = "Entity06";
        entity06["ordinal"] = 6;
        Register("Entity06", entity06);
    }

    public IReadOnlyDictionary<string, object> Entity06 => entity06;
}
