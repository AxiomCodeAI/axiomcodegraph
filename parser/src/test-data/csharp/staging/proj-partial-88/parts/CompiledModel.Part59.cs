// Part 59 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity59 = new Dictionary<string, object>();

    /// <summary>Configures entity type 59.</summary>
    private void Configure59()
    {
        entity59["name"] = "Entity59";
        entity59["ordinal"] = 59;
        Register("Entity59", entity59);
    }

    public IReadOnlyDictionary<string, object> Entity59 => entity59;
}
