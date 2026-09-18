// Part 44 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity44 = new Dictionary<string, object>();

    /// <summary>Configures entity type 44.</summary>
    private void Configure44()
    {
        entity44["name"] = "Entity44";
        entity44["ordinal"] = 44;
        Register("Entity44", entity44);
    }

    public IReadOnlyDictionary<string, object> Entity44 => entity44;
}
