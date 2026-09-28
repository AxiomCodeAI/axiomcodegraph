using MediatR;
namespace App.Mediated;

public record CreateWidget(string Name);

public class MediatedController
{
    private readonly ISender _mediator;
    public MediatedController(ISender mediator) { _mediator = mediator; }
    public Task<int> Create(string name) => Dispatch(new CreateWidget(name));
    private Task<int> Dispatch(CreateWidget c) => _mediator.Send(c);
    public int Size(string name) => Measure(name);
    private int Measure(string name) => name.Length;
}
