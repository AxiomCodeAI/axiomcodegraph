using System.Threading.Tasks;
using MediatR;

namespace Shop
{
    // CONTROL: a receiver that is not a mediator, with a Send of the same shape
    public interface IMailer { Task Send(object message); }

    public class OrdersController
    {
        private readonly IMediator _mediator;
        private readonly IMailer _mailer;
        public OrdersController(IMediator mediator, IMailer mailer) { _mediator = mediator; _mailer = mailer; }

        // Send<TResponse>(IRequest<TResponse>) with the request constructed at the call
        public Task<OrderView> Get(int id) => _mediator.Send(new GetOrder(id));

        // through a `var` local
        public async Task<OrderView> GetLocal(int id)
        {
            var query = new GetOrder(id);
            return await _mediator.Send(query);
        }

        // Send(object): the local is declared `object`, its value is a GetOrder
        public async Task<object?> GetUntyped(int id)
        {
            object request = new GetOrder(id);
            return await _mediator.Send(request);
        }

        // CONTROL: the same request handed to a mailer reaches no handler
        public Task Notify(int id) => _mailer.Send(new GetOrder(id));
    }

    // a minimal-API endpoint takes its services as one object: the mediator is a property
    public class OrderServices
    {
        public OrderServices(IMediator mediator) { Mediator = mediator; }
        public IMediator Mediator { get; }
    }

    public static class OrdersApi
    {
        public static Task<OrderView> GetOrder(OrderServices services, int id) =>
            services.Mediator.Send(new GetOrder(id));
    }

    // a mocking library's argument matcher, as a test writes it
    public static class Arg { public static T Any<T>() => default!; }

    // CONTROL: a test stubbing the mediator dispatches nothing
    public class OrdersControllerTest
    {
        private readonly IMediator _mediator;
        public OrdersControllerTest(IMediator mediator) { _mediator = mediator; }
        public Task<OrderView> StubGet() => _mediator.Send(Arg.Any<GetOrder>());
    }

    public class OrderCommands
    {
        private readonly ISender _sender;
        public OrderCommands(ISender sender) { _sender = sender; }

        // Send<TRequest>(TRequest) where TRequest : IRequest, through ISender
        public Task Close(int id) => _sender.Send(new CloseOrder(id));

        // a class that handles two requests
        public Task<int> Count(int bin) => _sender.Send(new CountWidgets(bin));
        public Task<double> Weigh(int bin) => _sender.Send(new WeighWidgets(bin));

        // constructed at the call, so exactly that type: the base's handler, and a derived
        // request's own handler and not its base's
        public Task<string> Shape(double size) => _sender.Send(new ShapeQuery(size));
        public Task<string> Circle(double r) => _sender.Send(new CircleQuery(r));

        // declared as the base, so at run time it may be a ShapeQuery, a CircleQuery or a
        // SquareQuery: each of the three handlers, and no handler outside the family
        public Task<string> Any(ShapeQuery query) => _sender.Send(query);
    }
}
