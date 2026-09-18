// Part 23 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity23 = new Dictionary<string, object>();

    /// <summary>Configures entity type 23.</summary>
    private void Configure23()
    {
        entity23["name"] = "Entity23";
        entity23["ordinal"] = 23;
        Register("Entity23", entity23);
    }

    public IReadOnlyDictionary<string, object> Entity23 => entity23;
}
