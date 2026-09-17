// Part 17 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity17 = new Dictionary<string, object>();

    /// <summary>Configures entity type 17.</summary>
    private void Configure17()
    {
        entity17["name"] = "Entity17";
        entity17["ordinal"] = 17;
        Register("Entity17", entity17);
    }

    public IReadOnlyDictionary<string, object> Entity17 => entity17;
}
