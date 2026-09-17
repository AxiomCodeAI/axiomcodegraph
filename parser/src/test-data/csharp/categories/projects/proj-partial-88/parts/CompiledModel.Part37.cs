// Part 37 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity37 = new Dictionary<string, object>();

    /// <summary>Configures entity type 37.</summary>
    private void Configure37()
    {
        entity37["name"] = "Entity37";
        entity37["ordinal"] = 37;
        Register("Entity37", entity37);
    }

    public IReadOnlyDictionary<string, object> Entity37 => entity37;
}
