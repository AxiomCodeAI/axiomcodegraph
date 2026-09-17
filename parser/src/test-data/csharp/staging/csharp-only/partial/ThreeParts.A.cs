// HALF TWO — declaration merging. THREE PARTS, part 1 of 3.
//
// Three parts of one generic partial type, each in its own file. The type
// parameter list must be IDENTICAL in every part; constraints may be stated in
// one part, or in several, but if stated more than once they must match
// exactly. Part 1 states them; parts 2 and 3 do not.
using System;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.Partials;

public partial class Repository<TEntity, TKey>
    where TEntity : class, IIdentity
    where TKey : notnull
{
    private readonly Dictionary<TKey, TEntity> store = new();

    public int Count => store.Count;

    public void Add(TKey key, TEntity entity) => store[key] = entity;
}
