// Part 47 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity47 = new Dictionary<string, object>();

    /// <summary>Configures entity type 47.</summary>
    private void Configure47()
    {
        entity47["name"] = "Entity47";
        entity47["ordinal"] = 47;
        Register("Entity47", entity47);
    }

    public IReadOnlyDictionary<string, object> Entity47 => entity47;
}
