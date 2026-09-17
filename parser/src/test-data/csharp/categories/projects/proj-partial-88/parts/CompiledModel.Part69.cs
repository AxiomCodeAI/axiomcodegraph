// Part 69 of 88 of ONE type identity: Fixtures.Partial88.CompiledModel.
// Generated shape, hand-written content — this is what a large ORM's generated
// compiled model looks like on disk. See ../Partial88.csproj for why 88.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, object> entity69 = new Dictionary<string, object>();

    /// <summary>Configures entity type 69.</summary>
    private void Configure69()
    {
        entity69["name"] = "Entity69";
        entity69["ordinal"] = 69;
        Register("Entity69", entity69);
    }

    public IReadOnlyDictionary<string, object> Entity69 => entity69;
}
