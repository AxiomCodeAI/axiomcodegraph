// Part 43 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity43 = new Dictionary<string, object>();

    /// <summary>Configures entity type 43.</summary>
    private void Configure43()
    {
        entity43["name"] = "Entity43";
        entity43["ordinal"] = 43;
        Register("Entity43", entity43);
    }

    public IReadOnlyDictionary<string, object> Entity43 => entity43;
}
