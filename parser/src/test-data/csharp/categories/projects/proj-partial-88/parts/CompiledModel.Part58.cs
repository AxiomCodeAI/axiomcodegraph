// Part 58 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity58 = new Dictionary<string, object>();

    /// <summary>Configures entity type 58.</summary>
    private void Configure58()
    {
        entity58["name"] = "Entity58";
        entity58["ordinal"] = 58;
        Register("Entity58", entity58);
    }

    public IReadOnlyDictionary<string, object> Entity58 => entity58;
}
