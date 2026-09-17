// Part 64 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity64 = new Dictionary<string, object>();

    /// <summary>Configures entity type 64.</summary>
    private void Configure64()
    {
        entity64["name"] = "Entity64";
        entity64["ordinal"] = 64;
        Register("Entity64", entity64);
    }

    public IReadOnlyDictionary<string, object> Entity64 => entity64;
}
