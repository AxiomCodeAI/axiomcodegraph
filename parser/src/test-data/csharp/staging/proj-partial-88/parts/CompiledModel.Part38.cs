// Part 38 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity38 = new Dictionary<string, object>();

    /// <summary>Configures entity type 38.</summary>
    private void Configure38()
    {
        entity38["name"] = "Entity38";
        entity38["ordinal"] = 38;
        Register("Entity38", entity38);
    }

    public IReadOnlyDictionary<string, object> Entity38 => entity38;
}
