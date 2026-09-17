// Part 60 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity60 = new Dictionary<string, object>();

    /// <summary>Configures entity type 60.</summary>
    private void Configure60()
    {
        entity60["name"] = "Entity60";
        entity60["ordinal"] = 60;
        Register("Entity60", entity60);
    }

    public IReadOnlyDictionary<string, object> Entity60 => entity60;
}
