using System.Threading;
using System.Threading.Tasks;
using MediatR;

namespace Shop
{
    // Read by tools/mediator-dispatch-test.sh only, not by the Roslyn score: the engine
    // leaves `next()`, an invocation of a generic delegate parameter, unresolved, and the
    // score would count it against the case. That gap is not the mediator's.

    // An OPEN pipeline behavior is registered for every request: every Send runs it.
    public class TimingBehavior<TReq, TRes> : IPipelineBehavior<TReq, TRes> where TReq : notnull
    {
        public Task<TRes> Handle(TReq request, RequestHandlerDelegate<TRes> next, CancellationToken ct) => next();
    }

    // A CLOSED behavior runs only around its own request type: the sends of GetOrder, and
    // (CONTROL) no other Send and no Publish.
    public class AuditGetOrder : IPipelineBehavior<GetOrder, OrderView>
    {
        public Task<OrderView> Handle(GetOrder request, RequestHandlerDelegate<OrderView> next, CancellationToken ct) => next();
    }
}
