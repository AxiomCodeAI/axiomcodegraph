// Part 67 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity67 = new Dictionary<string, object>();

    /// <summary>Configures entity type 67.</summary>
    private void Configure67()
    {
        entity67["name"] = "Entity67";
        entity67["ordinal"] = 67;
        Register("Entity67", entity67);
    }

    public IReadOnlyDictionary<string, object> Entity67 => entity67;
}
