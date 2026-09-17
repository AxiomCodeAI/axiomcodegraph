// Part 20 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity20 = new Dictionary<string, object>();

    /// <summary>Configures entity type 20.</summary>
    private void Configure20()
    {
        entity20["name"] = "Entity20";
        entity20["ordinal"] = 20;
        Register("Entity20", entity20);
    }

    public IReadOnlyDictionary<string, object> Entity20 => entity20;
}
