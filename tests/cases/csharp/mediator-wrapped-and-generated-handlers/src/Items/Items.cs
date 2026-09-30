using Mediator;

namespace Depot.Items;

public interface IItemService
{
    ValueTask Remove(int id);
    ValueTask Rename(int id, string name);
}

public record DeleteItemCommand(int Id) : ICommand<bool>;
public record RenameItemCommand(int Id, string Name) : ICommand<bool>;
public record GetItemQuery(int Id) : IQuery<string>;

public class DeleteItemHandler : ICommandHandler<DeleteItemCommand, bool>
{
    private readonly IItemService _items;
    public DeleteItemHandler(IItemService items) { _items = items; }

    public async ValueTask<bool> Handle(DeleteItemCommand command, CancellationToken cancellationToken)
    {
        await _items.Remove(command.Id);
        return true;
    }
}

public class RenameItemHandler : ICommandHandler<RenameItemCommand, bool>
{
    private readonly IItemService _items;
    public RenameItemHandler(IItemService items) { _items = items; }

    public async ValueTask<bool> Handle(RenameItemCommand command, CancellationToken cancellationToken)
    {
        await _items.Rename(command.Id, command.Name);
        return true;
    }
}

public class GetItemHandler : IQueryHandler<GetItemQuery, string>
{
    public ValueTask<string> Handle(GetItemQuery query, CancellationToken cancellationToken) => new("item");
}

public class ItemEndpoints
{
    private readonly IMediator _mediator;
    public ItemEndpoints(IMediator mediator) { _mediator = mediator; }

    public async Task<bool> Delete(int id, CancellationToken ct)
    {
        var cmd = new DeleteItemCommand(id);
        return await _mediator.Send(cmd, ct);
    }

    public async Task<string> Get(int id) => await _mediator.Send(new GetItemQuery(id));
}
