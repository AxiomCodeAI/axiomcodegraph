// Part 10 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity10 = new Dictionary<string, object>();

    /// <summary>Configures entity type 10.</summary>
    private void Configure10()
    {
        entity10["name"] = "Entity10";
        entity10["ordinal"] = 10;
        Register("Entity10", entity10);
    }

    public IReadOnlyDictionary<string, object> Entity10 => entity10;
}
