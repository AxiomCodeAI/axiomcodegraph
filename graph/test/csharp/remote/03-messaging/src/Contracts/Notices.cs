namespace Contracts
{
    // an event-bus hierarchy: a common base and two concrete notices
    public abstract class Notice { }
    public class Accepted : Notice { }
    public class Rejected : Notice { }
    public class Archived : Notice { }

    public interface IEventBus { System.Threading.Tasks.Task PublishAsync(Notice n); }
    public interface IIntegrationEventHandler<T> where T : Notice { System.Threading.Tasks.Task Handle(T n); }
}
