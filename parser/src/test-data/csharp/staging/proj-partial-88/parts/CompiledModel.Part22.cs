// Part 22 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity22 = new Dictionary<string, object>();

    /// <summary>Configures entity type 22.</summary>
    private void Configure22()
    {
        entity22["name"] = "Entity22";
        entity22["ordinal"] = 22;
        Register("Entity22", entity22);
    }

    public IReadOnlyDictionary<string, object> Entity22 => entity22;
}
