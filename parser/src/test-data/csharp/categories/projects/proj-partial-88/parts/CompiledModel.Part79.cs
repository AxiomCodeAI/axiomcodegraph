// Part 79 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity79 = new Dictionary<string, object>();

    /// <summary>Configures entity type 79.</summary>
    private void Configure79()
    {
        entity79["name"] = "Entity79";
        entity79["ordinal"] = 79;
        Register("Entity79", entity79);
    }

    public IReadOnlyDictionary<string, object> Entity79 => entity79;
}
