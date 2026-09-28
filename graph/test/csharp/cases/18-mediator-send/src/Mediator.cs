// Stand-ins for the mediator package's contracts, with its names and shapes, so the
// Roslyn oracle can compile the case. tools/mediator-dispatch-test.sh also runs the case
// with this file removed, which is the shape a real project has: the package unstaged.
using System.Threading;
using System.Threading.Tasks;

namespace MediatR
{
    public interface IBaseRequest { }
    public interface IRequest : IBaseRequest { }
    public interface IRequest<out TResponse> : IBaseRequest { }

    public interface IRequestHandler<in TRequest, TResponse> where TRequest : IRequest<TResponse>
    {
        Task<TResponse> Handle(TRequest request, CancellationToken cancellationToken);
    }

    public interface IRequestHandler<in TRequest> where TRequest : IRequest
    {
        Task Handle(TRequest request, CancellationToken cancellationToken);
    }

    public interface ISender
    {
        Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default);
        Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default) where TRequest : IRequest;
        Task<object?> Send(object request, CancellationToken cancellationToken = default);
    }

    public delegate Task<TResponse> RequestHandlerDelegate<TResponse>();

    public interface IPipelineBehavior<in TRequest, TResponse> where TRequest : notnull
    {
        Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken cancellationToken);
    }

    public interface INotification { }

    public interface INotificationHandler<in TNotification> where TNotification : INotification
    {
        Task Handle(TNotification notification, CancellationToken cancellationToken);
    }

    public interface IPublisher
    {
        Task Publish(object notification, CancellationToken cancellationToken = default);
        Task Publish<TNotification>(TNotification notification, CancellationToken cancellationToken = default)
            where TNotification : INotification;
    }

    public interface IMediator : ISender, IPublisher { }
}
