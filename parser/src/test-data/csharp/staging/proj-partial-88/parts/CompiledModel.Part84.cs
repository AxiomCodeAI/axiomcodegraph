// Part 84 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity84 = new Dictionary<string, object>();

    /// <summary>Configures entity type 84.</summary>
    private void Configure84()
    {
        entity84["name"] = "Entity84";
        entity84["ordinal"] = 84;
        Register("Entity84", entity84);
    }

    public IReadOnlyDictionary<string, object> Entity84 => entity84;
}
