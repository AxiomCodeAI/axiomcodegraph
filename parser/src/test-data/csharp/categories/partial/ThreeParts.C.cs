// HALF TWO — declaration merging. THREE PARTS, part 3 of 3.
// Restates the constraints verbatim, which is legal only because they match
// part 1 exactly, and adds a nested partial type of its own.
using System;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.Partials;

public partial class Repository<TEntity, TKey>
    where TEntity : class, IIdentity
    where TKey : notnull
{
    public TEntity? Find(TKey key) => store.TryGetValue(key, out TEntity? found) ? found : null;

    public IReadOnlyList<TEntity> All() => new List<TEntity>(store.Values);

    // A NESTED partial type inside a partial type: its declarationScopeKey is
    // the parent's group key, not the parent's declaration-site key, because
    // the parent has three of those.
    public partial class Statistics
    {
        public int Reads;
    }

    public partial class Statistics
    {
        public int Writes;

        public int Total => Reads + Writes;
    }
}
