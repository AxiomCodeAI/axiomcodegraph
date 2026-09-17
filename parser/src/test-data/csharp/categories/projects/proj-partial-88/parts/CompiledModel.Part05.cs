// Part 05 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity05 = new Dictionary<string, object>();

    /// <summary>Configures entity type 05.</summary>
    private void Configure05()
    {
        entity05["name"] = "Entity05";
        entity05["ordinal"] = 5;
        Register("Entity05", entity05);
    }

    public IReadOnlyDictionary<string, object> Entity05 => entity05;
}
