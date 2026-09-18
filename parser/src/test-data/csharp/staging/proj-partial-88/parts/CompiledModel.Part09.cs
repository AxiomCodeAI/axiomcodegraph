// Part 09 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity09 = new Dictionary<string, object>();

    /// <summary>Configures entity type 09.</summary>
    private void Configure09()
    {
        entity09["name"] = "Entity09";
        entity09["ordinal"] = 9;
        Register("Entity09", entity09);
    }

    public IReadOnlyDictionary<string, object> Entity09 => entity09;
}
