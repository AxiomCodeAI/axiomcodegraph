// Part TWO. The WHOLE namespace is inside #if HAVE_ASYNC, which is TRUE for
// this project, and the base list is split by a nested #if. Roslyn counts two
// parts for Reader; the parser counted one. Both directives are the shapes a
// multi-targeting library actually writes.
#if HAVE_ASYNC

using System;
using System.Threading.Tasks;

namespace Fixtures.PartialUnderIf
{
    public abstract partial class Reader
#if HAVE_ASYNC_DISPOSABLE
        : IAsyncDisposable
#endif
    {
        public virtual Task<bool> ReadAsync() => Task.FromResult(Read());
#if HAVE_ASYNC_DISPOSABLE
        public ValueTask DisposeAsync() { Dispose(); return default; }
#endif
    }
}

#endif
