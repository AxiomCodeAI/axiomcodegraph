using Example.Jobs;

namespace App;

public sealed class GetWidgetHandler : IJobHandler<string>
{
    public Task<string> Handle(CancellationToken ct) => Task.FromResult("widget");
}

// control: implements nothing
public sealed class GetOrderHelper
{
    public Task<string> Handle(CancellationToken ct) => Task.FromResult("order");
}
