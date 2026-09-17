// Part 30 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity30 = new Dictionary<string, object>();

    /// <summary>Configures entity type 30.</summary>
    private void Configure30()
    {
        entity30["name"] = "Entity30";
        entity30["ordinal"] = 30;
        Register("Entity30", entity30);
    }

    public IReadOnlyDictionary<string, object> Entity30 => entity30;
}
