using System.Threading.Tasks;
using MediatR;

namespace Shop
{
    // Read by tools/mediator-dispatch-test.sh only, not by the Roslyn score: the engine
    // does not resolve the partly qualified `new Legacy.GetOrder(id)`, and the score
    // would count that construction as a site resolved to nothing. The send still names
    // Shop.Legacy.GetOrder, so it reaches LegacyGetOrderHandler and not GetOrderHandler.
    public class LegacyOrders
    {
        private readonly IMediator _mediator;
        public LegacyOrders(IMediator mediator) { _mediator = mediator; }
        public Task<OrderView> Get(int id) => _mediator.Send(new Legacy.GetOrder(id));
    }
}
