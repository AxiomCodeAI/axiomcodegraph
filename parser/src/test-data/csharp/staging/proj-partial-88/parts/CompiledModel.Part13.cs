// Part 13 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity13 = new Dictionary<string, object>();

    /// <summary>Configures entity type 13.</summary>
    private void Configure13()
    {
        entity13["name"] = "Entity13";
        entity13["ordinal"] = 13;
        Register("Entity13", entity13);
    }

    public IReadOnlyDictionary<string, object> Entity13 => entity13;
}
