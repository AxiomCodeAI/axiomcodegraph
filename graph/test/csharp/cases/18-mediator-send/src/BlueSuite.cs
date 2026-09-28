using System.Threading;
using System.Threading.Tasks;
using MediatR;

namespace Shop
{
    // Two classes, each in its own file, each declare their own Ping and PingHandler: the
    // same simple names in two scopes, the shape of a mediator's own test suite. Each send
    // reaches the handler of ITS Ping, not the other class's.
    public class BlueSuite
    {
        public record Ping(string Text) : IRequest<string>;
        public class PingHandler : IRequestHandler<Ping, string>
        {
            public Task<string> Handle(Ping request, CancellationToken ct) => Task.FromResult("blue " + request.Text);
        }

        private readonly IMediator _mediator;
        public BlueSuite(IMediator mediator) { _mediator = mediator; }
        public Task<string> Run() => _mediator.Send(new Ping("x"));
    }
}
