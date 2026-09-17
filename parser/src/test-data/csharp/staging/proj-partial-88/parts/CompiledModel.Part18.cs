// Part 18 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity18 = new Dictionary<string, object>();

    /// <summary>Configures entity type 18.</summary>
    private void Configure18()
    {
        entity18["name"] = "Entity18";
        entity18["ordinal"] = 18;
        Register("Entity18", entity18);
    }

    public IReadOnlyDictionary<string, object> Entity18 => entity18;
}
