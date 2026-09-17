// Part 54 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity54 = new Dictionary<string, object>();

    /// <summary>Configures entity type 54.</summary>
    private void Configure54()
    {
        entity54["name"] = "Entity54";
        entity54["ordinal"] = 54;
        Register("Entity54", entity54);
    }

    public IReadOnlyDictionary<string, object> Entity54 => entity54;
}
