namespace App;

public sealed class SweepWorker : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken t) => Task.CompletedTask;
}

// control: not registered, not a BackgroundService
public sealed class Unused
{
    public Task ExecuteAsync(CancellationToken t) => Task.CompletedTask;
}

public sealed class Handlers
{
    [Subscribe("orders")]
    public void OnOrder(string body) { }

    [Obsolete]
    public void Legacy() { }
}

// a hosted service no registration in the graph names
public sealed class IdleWorker : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken t) => Task.CompletedTask;
}
