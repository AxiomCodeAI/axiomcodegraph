using MediatR;

namespace Depot.App;

public record IntegrationEvent;
public record WidgetShippedEvent(int WidgetId) : IntegrationEvent;

public interface IEventBus
{
    Task PublishAsync(IntegrationEvent e);
}

public interface IIntegrationEventHandler<in TEvent> where TEvent : IntegrationEvent
{
    Task Handle(TEvent e);
}

public class Stock
{
    public void MarkShipped(int widgetId) { }
    public void MarkRetired(int widgetId) { }
}

public class WidgetShippedHandler : IIntegrationEventHandler<WidgetShippedEvent>
{
    private readonly Stock _stock = new Stock();

    public Task Handle(WidgetShippedEvent e)
    {
        _stock.MarkShipped(e.WidgetId);
        return Task.CompletedTask;
    }
}

public class Notifier
{
    private readonly IEventBus _bus;

    public Notifier(IEventBus bus) { _bus = bus; }

    public async Task Notify(int widgetId)
    {
        await _bus.PublishAsync(new WidgetShippedEvent(widgetId));
    }
}

public class InMemoryBus : IEventBus
{
    public Task PublishAsync(IntegrationEvent e) => Task.CompletedTask;
}

public record RetireWidgetCommand(int WidgetId) : IRequest<bool>;

public class RetireWidgetHandler : IRequestHandler<RetireWidgetCommand, bool>
{
    private readonly Stock _stock = new Stock();

    public Task<bool> Handle(RetireWidgetCommand request, CancellationToken cancellationToken)
    {
        _stock.MarkRetired(request.WidgetId);
        return Task.FromResult(true);
    }
}

public class WidgetsController
{
    private readonly IMediator _mediator;

    public WidgetsController(IMediator mediator) { _mediator = mediator; }

    public async Task<bool> Retire(int id) => await _mediator.Send(new RetireWidgetCommand(id));
}
