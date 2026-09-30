using MediatR;

namespace Depot.App;

public record DeleteThingCommand(int Id) : IRequest;

public class DeleteThingCommandHandler : IRequestHandler<DeleteThingCommand>
{
    public Task Handle(DeleteThingCommand request, CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }
}

public record CountThingsQuery(int Shelf) : IRequest<int>;

public class CountThingsQueryHandler : IRequestHandler<CountThingsQuery, int>
{
    public Task<int> Handle(CountThingsQuery request, CancellationToken cancellationToken)
    {
        return Task.FromResult(request.Shelf);
    }
}

public record ArchiveThingCommand(int Id) : IRequest;

public class ArchiveThingCommandHandler : IRequestHandler<ArchiveThingCommand>
{
    public Task Handle(ArchiveThingCommand request, CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }
}

public class ThingEndpoints
{
    public async Task Archive(ISender sender, int id)
    {
        await sender.Send(new ArchiveThingCommand(id));
    }
}
