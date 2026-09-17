// Part 45 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity45 = new Dictionary<string, object>();

    /// <summary>Configures entity type 45.</summary>
    private void Configure45()
    {
        entity45["name"] = "Entity45";
        entity45["ordinal"] = 45;
        Register("Entity45", entity45);
    }

    public IReadOnlyDictionary<string, object> Entity45 => entity45;
}
