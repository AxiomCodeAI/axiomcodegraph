using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

public static class ProbeEndpoints
{
    public static IResult Probe() => Results.Ok();
    public static IResult SetGauge(int value) => Results.Ok(value);
    public static IResult ClearMeter() => Results.NoContent();
    public static IResult TurnDial(int by) => Results.Ok(by);
    public static IResult Anything() => Results.Ok();
    public static string[] Verbs() => new[] { "GET" };
}

public static class GadgetEndpoints
{
    public static IResult Show(int id) => Results.Ok(id);
    public static IResult User(int id) => Results.Ok(id);
}

public static class ItemEndpoints
{
    // mapped under two groups: it serves under both prefixes
    public static RouteGroupBuilder MapItemEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/{id}", GetItem);
        return group;
    }

    public static IResult GetItem(int id) => Results.Ok(id);
}

public static class ItemAdmin
{
    // a plain parameter, not an extension
    public static void MapAdmin(RouteGroupBuilder admin)
    {
        admin.MapDelete("/items/{id}", Purge);
    }

    public static IResult Purge(int id) => Results.NoContent();
}

public static class HealthEndpoints
{
    public static void MapHealth(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/health", Health);
    }

    public static IResult Health() => Results.Ok();
}

public static class Store { public static int[] All() => new int[0]; }
