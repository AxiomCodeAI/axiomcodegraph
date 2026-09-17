// Part 87 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity87 = new Dictionary<string, object>();

    /// <summary>Configures entity type 87.</summary>
    private void Configure87()
    {
        entity87["name"] = "Entity87";
        entity87["ordinal"] = 87;
        Register("Entity87", entity87);
    }

    public IReadOnlyDictionary<string, object> Entity87 => entity87;
}
