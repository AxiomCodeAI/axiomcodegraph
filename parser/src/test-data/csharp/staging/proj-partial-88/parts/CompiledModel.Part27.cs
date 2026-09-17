// Part 27 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity27 = new Dictionary<string, object>();

    /// <summary>Configures entity type 27.</summary>
    private void Configure27()
    {
        entity27["name"] = "Entity27";
        entity27["ordinal"] = 27;
        Register("Entity27", entity27);
    }

    public IReadOnlyDictionary<string, object> Entity27 => entity27;
}
