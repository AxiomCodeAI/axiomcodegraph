// HALF TWO — declaration merging. THREE PARTS, part 2 of 3.
// Adds an interface and reads state declared in part 1.
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.Partials;

public partial class Repository<TEntity, TKey> : IReadOnlyCollection<TEntity>
{
    public IEnumerator<TEntity> GetEnumerator() => store.Values.GetEnumerator();

    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() =>
        GetEnumerator();
}
