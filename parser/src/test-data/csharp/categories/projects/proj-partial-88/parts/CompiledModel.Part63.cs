// Part 63 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity63 = new Dictionary<string, object>();

    /// <summary>Configures entity type 63.</summary>
    private void Configure63()
    {
        entity63["name"] = "Entity63";
        entity63["ordinal"] = 63;
        Register("Entity63", entity63);
    }

    public IReadOnlyDictionary<string, object> Entity63 => entity63;
}
