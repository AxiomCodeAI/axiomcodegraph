using MediatR;
using NSubstitute;
using Xunit;

namespace Depot.App.Tests;

public class DeliveryTests
{
    [Fact]
    public async Task PublishesOnAMockedBus()
    {
        var bus = Substitute.For<IEventBus>();
        await new Notifier(bus).Notify(7);
    }

    [Fact]
    public async Task PublishesOnARealBus()
    {
        await new Notifier(new InMemoryBus()).Notify(7);
    }

    [Fact]
    public async Task RetiresThroughAMockedMediator()
    {
        var mediator = Substitute.For<IMediator>();
        await new WidgetsController(mediator).Retire(3);
    }

    [Fact]
    public async Task RetiresThroughTheHandler()
    {
        await new RetireWidgetHandler().Handle(new RetireWidgetCommand(3), CancellationToken.None);
    }
}
