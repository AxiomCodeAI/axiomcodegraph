using System.Threading;
using System.Threading.Tasks;
using MediatR;

namespace Shop
{
    public record OrderView(int Id, string State);

    public record GetOrder(int Id) : IRequest<OrderView>;
    public class GetOrderHandler : IRequestHandler<GetOrder, OrderView>
    {
        public Task<OrderView> Handle(GetOrder request, CancellationToken ct) =>
            Task.FromResult(new OrderView(request.Id, "open"));
    }

    // a request that answers nothing: IRequestHandler<TRequest>
    public record CloseOrder(int Id) : IRequest;
    public class CloseOrderHandler : IRequestHandler<CloseOrder>
    {
        public Task Handle(CloseOrder request, CancellationToken ct) => Task.CompletedTask;
    }

    // CONTROL: the same response type as GetOrder, and nothing sends it
    public record ArchiveOrder(int Id) : IRequest<OrderView>;
    public class ArchiveOrderHandler : IRequestHandler<ArchiveOrder, OrderView>
    {
        public Task<OrderView> Handle(ArchiveOrder request, CancellationToken ct) =>
            Task.FromResult(new OrderView(request.Id, "archived"));
    }

    // CONTROL: a handler for ANOTHER GetOrder, named by a partly qualified argument
    public class LegacyGetOrderHandler : IRequestHandler<Legacy.GetOrder, OrderView>
    {
        public Task<OrderView> Handle(Legacy.GetOrder request, CancellationToken ct) =>
            Task.FromResult(new OrderView(request.Id, "legacy"));
    }

    // one class handling two requests: each send reaches only the Handle for its type
    public record CountWidgets(int Bin) : IRequest<int>;
    public record WeighWidgets(int Bin) : IRequest<double>;
    public class WidgetHandlers : IRequestHandler<CountWidgets, int>, IRequestHandler<WeighWidgets, double>
    {
        public Task<int> Handle(CountWidgets request, CancellationToken ct) => Task.FromResult(3);
        public Task<double> Handle(WeighWidgets request, CancellationToken ct) => Task.FromResult(1.5);
    }

    // a request family: the container looks the handler up by the RUNTIME type
    public record ShapeQuery(double Size) : IRequest<string>;
    public record CircleQuery(double R) : ShapeQuery(R);
    public record SquareQuery(double S) : ShapeQuery(S);
    public class ShapeQueryHandler : IRequestHandler<ShapeQuery, string>
    {
        public Task<string> Handle(ShapeQuery request, CancellationToken ct) => Task.FromResult("shape");
    }
    public class CircleQueryHandler : IRequestHandler<CircleQuery, string>
    {
        public Task<string> Handle(CircleQuery request, CancellationToken ct) => Task.FromResult("circle");
    }
    // CONTROL: handled, and nothing sends it
    public class SquareQueryHandler : IRequestHandler<SquareQuery, string>
    {
        public Task<string> Handle(SquareQuery request, CancellationToken ct) => Task.FromResult("square");
    }
}
