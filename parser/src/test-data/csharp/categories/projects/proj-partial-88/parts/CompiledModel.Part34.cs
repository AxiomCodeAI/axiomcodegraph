// Part 34 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity34 = new Dictionary<string, object>();

    /// <summary>Configures entity type 34.</summary>
    private void Configure34()
    {
        entity34["name"] = "Entity34";
        entity34["ordinal"] = 34;
        Register("Entity34", entity34);
    }

    public IReadOnlyDictionary<string, object> Entity34 => entity34;
}
