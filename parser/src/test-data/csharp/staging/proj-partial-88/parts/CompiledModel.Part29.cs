// Part 29 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity29 = new Dictionary<string, object>();

    /// <summary>Configures entity type 29.</summary>
    private void Configure29()
    {
        entity29["name"] = "Entity29";
        entity29["ordinal"] = 29;
        Register("Entity29", entity29);
    }

    public IReadOnlyDictionary<string, object> Entity29 => entity29;
}
