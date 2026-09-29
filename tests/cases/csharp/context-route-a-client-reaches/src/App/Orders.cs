namespace App;

public sealed class OrderListEndpoint
{
    public void AddRoute(IEndpointRouteBuilder app)
    {
        app.MapGet("api/orders",
            async (int? page, OrderStore s) => await Task.FromResult(Results.Ok(s.Page(page ?? 0))));
    }
}

public sealed class OrderStore
{
    public string[] Page(int n) => new[] { "a" };
}

public static class Shared
{
    public static HttpClient Client { get; } = new HttpClient();
}

public sealed class OrderChecks
{
    public Task<string> ListFirst() => Shared.Client.GetStringAsync("/api/orders?page=0");
}
