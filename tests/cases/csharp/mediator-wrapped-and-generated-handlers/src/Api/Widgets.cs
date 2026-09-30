using MediatR;

namespace Depot.Api;

public class Widget
{
    public void Archive() { }
    public void Paint() { }
}

public record ArchiveWidgetCommand(int WidgetId) : IRequest<int>;
public record PaintWidgetCommand(int WidgetId) : IRequest<int>;

public class Envelope<T, R> : IRequest<R> where T : IRequest<R>
{
    public T Inner { get; }
    public Envelope(T inner) { Inner = inner; }
}

public abstract class EnvelopeHandler<T, R> : IRequestHandler<Envelope<T, R>, R> where T : IRequest<R>
{
    private readonly ISender _sender;

    protected EnvelopeHandler(ISender sender) { _sender = sender; }

    public async Task<R> Handle(Envelope<T, R> envelope, CancellationToken cancellationToken)
    {
        var inner = envelope.Inner;
        return await _sender.Send(inner, cancellationToken);
    }
}

public class ArchiveWidgetEnvelopeHandler : EnvelopeHandler<ArchiveWidgetCommand, int>
{
    public ArchiveWidgetEnvelopeHandler(ISender sender) : base(sender) { }
}

public class ArchiveWidgetHandler : IRequestHandler<ArchiveWidgetCommand, int>
{
    private readonly Widget _widget = new Widget();

    public Task<int> Handle(ArchiveWidgetCommand request, CancellationToken cancellationToken)
    {
        _widget.Archive();
        return Task.FromResult(request.WidgetId);
    }
}

public class PaintWidgetHandler : IRequestHandler<PaintWidgetCommand, int>
{
    private readonly Widget _widget = new Widget();

    public Task<int> Handle(PaintWidgetCommand request, CancellationToken cancellationToken)
    {
        _widget.Paint();
        return Task.FromResult(request.WidgetId);
    }
}

public static class WidgetsApi
{
    public static async Task<int> ArchiveAsync(ISender sender, int id)
    {
        var wrapped = new Envelope<ArchiveWidgetCommand, int>(new ArchiveWidgetCommand(id));
        return await sender.Send(wrapped);
    }

    public static async Task<int> PaintAsync(ISender sender, int id)
    {
        return await sender.Send(new PaintWidgetCommand(id));
    }
}
