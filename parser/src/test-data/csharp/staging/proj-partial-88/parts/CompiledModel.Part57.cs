// Part 57 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity57 = new Dictionary<string, object>();

    /// <summary>Configures entity type 57.</summary>
    private void Configure57()
    {
        entity57["name"] = "Entity57";
        entity57["ordinal"] = 57;
        Register("Entity57", entity57);
    }

    public IReadOnlyDictionary<string, object> Entity57 => entity57;
}
