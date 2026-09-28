using System.Threading;
using System.Threading.Tasks;
using MediatR;

namespace Shop
{
    // Publish runs EVERY handler for the notification's type, and INotificationHandler is
    // contravariant: a handler of a base notification runs for each derived one too.
    public record OrderEvent(int Id) : INotification;
    public record OrderPlaced(int Id) : OrderEvent(Id);
    public record OrderShipped(int Id) : OrderEvent(Id);

    public class EmailOnOrderPlaced : INotificationHandler<OrderPlaced>
    {
        public Task Handle(OrderPlaced notification, CancellationToken ct) => Task.CompletedTask;
    }
    public class AuditOnOrderPlaced : INotificationHandler<OrderPlaced>
    {
        public Task Handle(OrderPlaced notification, CancellationToken ct) => Task.CompletedTask;
    }
    // a handler of the BASE notification: every OrderEvent published reaches it
    public class LogOrderEvent : INotificationHandler<OrderEvent>
    {
        public Task Handle(OrderEvent notification, CancellationToken ct) => Task.CompletedTask;
    }
    // CONTROL: a sibling of the published notification, handled, and nothing publishes it
    public class ShipOnOrderShipped : INotificationHandler<OrderShipped>
    {
        public Task Handle(OrderShipped notification, CancellationToken ct) => Task.CompletedTask;
    }

    // CONTROL: an unrelated notification, handled, and nothing publishes it
    public record WidgetMoved(int Id) : INotification;
    public class LogWidgetMoved : INotificationHandler<WidgetMoved>
    {
        public Task Handle(WidgetMoved notification, CancellationToken ct) => Task.CompletedTask;
    }

    public class OrderEvents
    {
        private readonly IPublisher _publisher;
        private readonly IMediator _mediator;
        public OrderEvents(IPublisher publisher, IMediator mediator) { _publisher = publisher; _mediator = mediator; }

        // the fan: both OrderPlaced handlers and the OrderEvent handler
        public Task Place(int id) => _publisher.Publish(new OrderPlaced(id));

        // through the mediator, and through a local
        public Task PlaceAgain(int id)
        {
            var placed = new OrderPlaced(id);
            return _mediator.Publish(placed);
        }

        // declared as the base: every handler in the family, and not LogWidgetMoved
        public Task Announce(OrderEvent notification) => _publisher.Publish(notification);

        // CONTROL: declared as the marker interface, which every notification implements;
        // nothing is linked rather than every handler of the project
        public Task Relay(INotification notification) => _publisher.Publish(notification);

        // CONTROL: a notification Sent is not Published; no notification handler runs (an
        // open pipeline step is still linked: the engine does not check that it is a request)
        public Task Misrouted(int id) => _mediator.Send(new OrderPlaced(id));
    }
}
