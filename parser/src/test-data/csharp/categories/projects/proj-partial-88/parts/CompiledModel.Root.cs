// The 89th FILE but not an 89th part of the same shape: this one carries the
// members the other 88 call. The identity therefore has 89 declaration sites,
// which is deliberately one more than the corpus maximum so that an off-by-one
// in the grouping shows up as a wrong number rather than as a coincidence.
using System;
using System.Collections.Generic;

namespace Fixtures.Partial88;

public partial class CompiledModel
{
    private readonly Dictionary<string, IReadOnlyDictionary<string, object>> registry =
        new Dictionary<string, IReadOnlyDictionary<string, object>>();

    public int Count => registry.Count;

    private void Register(string name, IReadOnlyDictionary<string, object> entity) =>
        registry[name] = entity;

    public void ConfigureAll()
    {
  Configure35();
        Configure36();
        Configure37();
        Configure38();
        Configure39();
        Configure40();
        Configure41();
        Configure42();
        Configure43();
        Configure44();
        Configure45();
        Configure46();
        Configure47();
        Configure48();
        Configure49();
        Configure50();
        Configure51();
        Configure52();
        Configure53();
        Configure54();
        Configure55();
        Configure56();
        Configure57();
        Configure58();
        Configure59();
        Configure60();
        Configure61();
        Configure62();
        Configure63();
        Configure64();
        Configure65();
        Configure66();
        Configure67();
        Configure68();
        Configure69();
        Configure70();
        Configure71();
        Configure72();
        Configure73();
        Configure74();
        Configure75();
        Configure76();
        Configure77();
        Configure78();
        Configure79();
        Configure80();
        Configure81();
        Configure82();
        Configure83();
        Configure84();
        Configure85();
        Configure86();
        Configure87();
        Configure88();
    }
}
