// Part 78 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity78 = new Dictionary<string, object>();

    /// <summary>Configures entity type 78.</summary>
    private void Configure78()
    {
        entity78["name"] = "Entity78";
        entity78["ordinal"] = 78;
        Register("Entity78", entity78);
    }

    public IReadOnlyDictionary<string, object> Entity78 => entity78;
}
