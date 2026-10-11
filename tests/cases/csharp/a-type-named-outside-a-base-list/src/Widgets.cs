public class WidgetStore
{
    public int Count() => 0;
}

public class WidgetSweeper : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken ct) => Task.CompletedTask;
}

public class WidgetMiddleware
{
    private readonly RequestDelegate _next;
    public WidgetMiddleware(RequestDelegate next) { _next = next; }
    public Task InvokeAsync(HttpContext ctx) => _next(ctx);
}

// Unused is named in this comment and in the string below, never as a type
public class Unused
{
    public string Label() => "Unused";
}

public class BaseThing
{
}

public class DerivedThing : BaseThing
{
}
