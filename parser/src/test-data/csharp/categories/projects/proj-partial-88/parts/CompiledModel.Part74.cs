// Part 74 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity74 = new Dictionary<string, object>();

    /// <summary>Configures entity type 74.</summary>
    private void Configure74()
    {
        entity74["name"] = "Entity74";
        entity74["ordinal"] = 74;
        Register("Entity74", entity74);
    }

    public IReadOnlyDictionary<string, object> Entity74 => entity74;
}
