// Part 82 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity82 = new Dictionary<string, object>();

    /// <summary>Configures entity type 82.</summary>
    private void Configure82()
    {
        entity82["name"] = "Entity82";
        entity82["ordinal"] = 82;
        Register("Entity82", entity82);
    }

    public IReadOnlyDictionary<string, object> Entity82 => entity82;
}
