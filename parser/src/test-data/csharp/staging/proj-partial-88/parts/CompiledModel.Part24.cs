// Part 24 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity24 = new Dictionary<string, object>();

    /// <summary>Configures entity type 24.</summary>
    private void Configure24()
    {
        entity24["name"] = "Entity24";
        entity24["ordinal"] = 24;
        Register("Entity24", entity24);
    }

    public IReadOnlyDictionary<string, object> Entity24 => entity24;
}
