// Part 03 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity03 = new Dictionary<string, object>();

    /// <summary>Configures entity type 03.</summary>
    private void Configure03()
    {
        entity03["name"] = "Entity03";
        entity03["ordinal"] = 3;
        Register("Entity03", entity03);
    }

    public IReadOnlyDictionary<string, object> Entity03 => entity03;
}
