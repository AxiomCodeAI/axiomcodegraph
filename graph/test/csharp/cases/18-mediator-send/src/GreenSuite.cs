using System.Threading;
using System.Threading.Tasks;
using MediatR;

namespace Shop
{
    public class GreenSuite
    {
        public record Ping(string Text) : IRequest<string>;
        public class PingHandler : IRequestHandler<Ping, string>
        {
            public Task<string> Handle(Ping request, CancellationToken ct) => Task.FromResult("green " + request.Text);
        }

        private readonly IMediator _mediator;
        public GreenSuite(IMediator mediator) { _mediator = mediator; }
        public Task<string> Run()
        {
            var ping = new Ping("y");
            return _mediator.Send(ping);
        }
    }
}
