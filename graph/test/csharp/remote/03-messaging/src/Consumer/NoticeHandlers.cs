using System.Threading.Tasks;
using Contracts;

namespace Consumer
{
    public class AcceptedHandler : IIntegrationEventHandler<Accepted> { public Task Handle(Accepted n) => Task.CompletedTask; }
    public class RejectedHandler : IIntegrationEventHandler<Rejected> { public Task Handle(Rejected n) => Task.CompletedTask; }
    // nothing publishes Archived by name; only the outbox could, so it is not "unsent"
    public class ArchivedHandler : IIntegrationEventHandler<Archived> { public Task Handle(Archived n) => Task.CompletedTask; }
}
