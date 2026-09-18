// Part 49 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity49 = new Dictionary<string, object>();

    /// <summary>Configures entity type 49.</summary>
    private void Configure49()
    {
        entity49["name"] = "Entity49";
        entity49["ordinal"] = 49;
        Register("Entity49", entity49);
    }

    public IReadOnlyDictionary<string, object> Entity49 => entity49;
}
