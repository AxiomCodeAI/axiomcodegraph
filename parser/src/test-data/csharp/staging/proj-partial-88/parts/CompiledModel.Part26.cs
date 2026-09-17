// Part 26 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity26 = new Dictionary<string, object>();

    /// <summary>Configures entity type 26.</summary>
    private void Configure26()
    {
        entity26["name"] = "Entity26";
        entity26["ordinal"] = 26;
        Register("Entity26", entity26);
    }

    public IReadOnlyDictionary<string, object> Entity26 => entity26;
}
