// Part 04 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity04 = new Dictionary<string, object>();

    /// <summary>Configures entity type 04.</summary>
    private void Configure04()
    {
        entity04["name"] = "Entity04";
        entity04["ordinal"] = 4;
        Register("Entity04", entity04);
    }

    public IReadOnlyDictionary<string, object> Entity04 => entity04;
}
