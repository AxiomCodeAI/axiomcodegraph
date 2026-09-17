// Part 77 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity77 = new Dictionary<string, object>();

    /// <summary>Configures entity type 77.</summary>
    private void Configure77()
    {
        entity77["name"] = "Entity77";
        entity77["ordinal"] = 77;
        Register("Entity77", entity77);
    }

    public IReadOnlyDictionary<string, object> Entity77 => entity77;
}
