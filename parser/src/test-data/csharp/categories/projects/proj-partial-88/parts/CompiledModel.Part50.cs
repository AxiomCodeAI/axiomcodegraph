// Part 50 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity50 = new Dictionary<string, object>();

    /// <summary>Configures entity type 50.</summary>
    private void Configure50()
    {
        entity50["name"] = "Entity50";
        entity50["ordinal"] = 50;
        Register("Entity50", entity50);
    }

    public IReadOnlyDictionary<string, object> Entity50 => entity50;
}
