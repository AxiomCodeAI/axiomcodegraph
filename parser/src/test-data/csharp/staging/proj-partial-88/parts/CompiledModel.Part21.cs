// Part 21 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity21 = new Dictionary<string, object>();

    /// <summary>Configures entity type 21.</summary>
    private void Configure21()
    {
        entity21["name"] = "Entity21";
        entity21["ordinal"] = 21;
        Register("Entity21", entity21);
    }

    public IReadOnlyDictionary<string, object> Entity21 => entity21;
}
