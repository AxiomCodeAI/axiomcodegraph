// Part 70 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity70 = new Dictionary<string, object>();

    /// <summary>Configures entity type 70.</summary>
    private void Configure70()
    {
        entity70["name"] = "Entity70";
        entity70["ordinal"] = 70;
        Register("Entity70", entity70);
    }

    public IReadOnlyDictionary<string, object> Entity70 => entity70;
}
