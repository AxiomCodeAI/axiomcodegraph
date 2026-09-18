// Part 01 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity01 = new Dictionary<string, object>();

    /// <summary>Configures entity type 01.</summary>
    private void Configure01()
    {
        entity01["name"] = "Entity01";
        entity01["ordinal"] = 1;
        Register("Entity01", entity01);
    }

    public IReadOnlyDictionary<string, object> Entity01 => entity01;
}
