// Part 19 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity19 = new Dictionary<string, object>();

    /// <summary>Configures entity type 19.</summary>
    private void Configure19()
    {
        entity19["name"] = "Entity19";
        entity19["ordinal"] = 19;
        Register("Entity19", entity19);
    }

    public IReadOnlyDictionary<string, object> Entity19 => entity19;
}
