// Part 86 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity86 = new Dictionary<string, object>();

    /// <summary>Configures entity type 86.</summary>
    private void Configure86()
    {
        entity86["name"] = "Entity86";
        entity86["ordinal"] = 86;
        Register("Entity86", entity86);
    }

    public IReadOnlyDictionary<string, object> Entity86 => entity86;
}
