using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using MediatR;

namespace Shop
{
    public record Widget(int Id);

    // a GENERIC request: the handler is chosen by the request type WITH its arguments
    public record GetById<T>(int Id) : IRequest<T>;
    public class GetOrderById : IRequestHandler<GetById<OrderView>, OrderView>
    {
        public Task<OrderView> Handle(GetById<OrderView> request, CancellationToken ct) =>
            Task.FromResult(new OrderView(request.Id, "by id"));
    }
    // CONTROL: the same generic request closed over another type, and nothing sends it
    public class GetWidgetById : IRequestHandler<GetById<Widget>, Widget>
    {
        public Task<Widget> Handle(GetById<Widget> request, CancellationToken ct) =>
            Task.FromResult(new Widget(request.Id));
    }

    // an OPEN generic handler: one class serves the request closed over any type
    public record ListAll<T>(int Page) : IRequest<List<T>>;
    public class ListAllHandler<T> : IRequestHandler<ListAll<T>, List<T>>
    {
        public Task<List<T>> Handle(ListAll<T> request, CancellationToken ct) => Task.FromResult(new List<T>());
    }

    public class Catalog
    {
        private readonly ISender _sender;
        public Catalog(ISender sender) { _sender = sender; }

        public Task<OrderView> Order(int id) => _sender.Send(new GetById<OrderView>(id));
        public Task<List<Widget>> Widgets(int page) => _sender.Send(new ListAll<Widget>(page));
    }
}
