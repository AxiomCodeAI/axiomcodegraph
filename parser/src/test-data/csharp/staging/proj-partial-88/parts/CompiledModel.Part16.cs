// Part 16 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity16 = new Dictionary<string, object>();

    /// <summary>Configures entity type 16.</summary>
    private void Configure16()
    {
        entity16["name"] = "Entity16";
        entity16["ordinal"] = 16;
        Register("Entity16", entity16);
    }

    public IReadOnlyDictionary<string, object> Entity16 => entity16;
}
