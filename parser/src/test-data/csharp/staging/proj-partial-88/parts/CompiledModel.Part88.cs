// Part 88 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity88 = new Dictionary<string, object>();

    /// <summary>Configures entity type 88.</summary>
    private void Configure88()
    {
        entity88["name"] = "Entity88";
        entity88["ordinal"] = 88;
        Register("Entity88", entity88);
    }

    public IReadOnlyDictionary<string, object> Entity88 => entity88;
}
