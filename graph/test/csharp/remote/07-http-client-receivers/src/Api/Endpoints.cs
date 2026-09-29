using Microsoft.AspNetCore.Builder;

namespace Depot.Api;

public static class DepotEndpoints
{
    public static string Health() => "ok";
    public static string Count() => "0";
    public static string Stats() => "1";
    public static string Version() => "2";
    public static string Ready() => "3";
    public static void Map(WebApplication app)
    {
        app.MapGet("/health", Health);
        app.MapGet("/count", Count);
        app.MapGet("/stats", Stats);
        app.MapGet("/version", Version);
        app.MapGet("/ready", Ready);
    }
}
