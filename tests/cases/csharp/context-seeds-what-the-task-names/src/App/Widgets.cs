namespace App.Widgets;

public record CreateWidgetCommand(string Name, int Size);

public class CreateWidgetCommandValidator
{
    public bool Validate(CreateWidgetCommand c) => c.Name != "" && c.Size <= 10;
}

public class CreateWidgetCommandHandler
{
    private readonly WidgetStore _store;
    public CreateWidgetCommandHandler(WidgetStore store) { _store = store; }
    public int Handle(CreateWidgetCommand c) => _store.Add(c.Name);
}

public class WidgetStore
{
    private readonly List<string> _names = new();
    public int Add(string name) { _names.Add(name); return _names.Count; }
}

public interface IDispatcher { Task<int> Send(object request); }

public class WidgetController
{
    private readonly IDispatcher _mediator;
    public WidgetController(IDispatcher mediator) { _mediator = mediator; }
    public Task<int> Create(string name) => Dispatch(new CreateWidgetCommand(name, 1));
    private Task<int> Dispatch(CreateWidgetCommand c) => _mediator.Send(c);
}
