using System.Threading.Tasks;
using Contracts;

namespace Producer
{
    public class NoticePublisher
    {
        private readonly IEventBus _bus;
        public NoticePublisher(IEventBus bus) { _bus = bus; }

        // a local declared as the base, assigned a concrete notice on each branch
        public Task Decide(bool ok)
        {
            Notice n;
            if (ok) { n = new Accepted(); } else { n = new Rejected(); }
            return _bus.PublishAsync(n);
        }

        // an outbox: whatever was stored, published as the base. The concrete notice is a
        // run-time fact: undetermined, and it covers every handler of a subtype.
        public Task Flush(Notice stored) => _bus.PublishAsync(stored);
    }
}
