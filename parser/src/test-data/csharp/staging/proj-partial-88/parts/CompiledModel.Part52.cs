// Part 52 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity52 = new Dictionary<string, object>();

    /// <summary>Configures entity type 52.</summary>
    private void Configure52()
    {
        entity52["name"] = "Entity52";
        entity52["ordinal"] = 52;
        Register("Entity52", entity52);
    }

    public IReadOnlyDictionary<string, object> Entity52 => entity52;
}
