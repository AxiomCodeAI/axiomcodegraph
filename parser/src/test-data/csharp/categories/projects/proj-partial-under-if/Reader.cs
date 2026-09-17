// Part ONE of a two-part partial. Ordinary. The other part is Reader.Async.cs.
using System;
namespace Fixtures.PartialUnderIf
{
    public abstract partial class Reader : IDisposable
    {
        public abstract bool Read();
        public void Dispose() { }
    }
}
