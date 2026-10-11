using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Shop;

public static class Audit
{
    public static void Record(string what) { }
    public static void Forget(string what) { }
}

public sealed class TenantFilter : IEndpointFilter
{
    public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext c, EndpointFilterDelegate next)
    {
        Audit.Record("tenant");
        return next(c);
    }
}

public static class OrderEndpoints
{
    public static RouteGroupBuilder MapOrders(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/orders").AddEndpointFilter<TenantFilter>();
        group.MapPost("/", Create);
        // CONTROL: a sibling group with no filter
        routes.MapGroup("/health").MapGet("/", Health);
        return group;
    }

    static string Create() => "created";
    static string Health() => "ok";
}

public sealed class Ledger
{
    public int Settle(int n) => n;
    public int Reopen(int n) => n;
}

public static class Jobs
{
    public static int Nightly(Ledger ledger) => ledger.Settle(1);
    // the receiver's type is a library type the graph does not hold
    public static int Replay(dynamic source) => source.Settle(2);
    public static int Rewind(External.Source source) => source.Settle(3);
    public static int Undo(External.Source source) => source.Reopen(4);
}
