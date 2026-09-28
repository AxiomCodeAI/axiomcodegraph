using MediatR;

namespace Shop.Legacy
{
    // another request with the simple name GetOrder, in its own namespace and file
    public record GetOrder(int Id) : IRequest<OrderView>;
}
