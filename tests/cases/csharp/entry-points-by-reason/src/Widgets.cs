namespace App;

public sealed class Store { public void List() { } }

public sealed class WidgetRoutes
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapGet("api/widgets", (Store s) => Handle(s));
    }
    public IResult Handle(Store s) { s.List(); return Results.Ok(); }
}

public sealed class UserRoutes
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapGet("api/users", Handle);
    }
    public static IResult Handle(Store s) { s.List(); return Results.Ok(); }
}

public class Worker(Store s) : BackgroundService
{
    public override Task StartAsync(CancellationToken ct) { s.List(); return base.StartAsync(ct); }
    protected override Task ExecuteAsync(CancellationToken ct) => Task.CompletedTask;
}

public sealed class TimedWorker(Store s) : Worker(s)
{
    public override Task StartAsync(CancellationToken ct) => base.StartAsync(ct);
}

public interface IAudit { void Record(Store s); }

public sealed class Audit : IAudit
{
    public void Record(Store s) { s.List(); }
}

public sealed class Nightly
{
    private readonly IAudit _audit = new Audit();
    public void Run(Store s) { _audit.Record(s); }
}
