// Part 41 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity41 = new Dictionary<string, object>();

    /// <summary>Configures entity type 41.</summary>
    private void Configure41()
    {
        entity41["name"] = "Entity41";
        entity41["ordinal"] = 41;
        Register("Entity41", entity41);
    }

    public IReadOnlyDictionary<string, object> Entity41 => entity41;
}
