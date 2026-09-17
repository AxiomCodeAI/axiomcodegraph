// Part 55 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity55 = new Dictionary<string, object>();

    /// <summary>Configures entity type 55.</summary>
    private void Configure55()
    {
        entity55["name"] = "Entity55";
        entity55["ordinal"] = 55;
        Register("Entity55", entity55);
    }

    public IReadOnlyDictionary<string, object> Entity55 => entity55;
}
