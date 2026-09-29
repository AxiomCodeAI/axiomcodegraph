using Grpc.Core;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

namespace Shop;

// CONTROL: a second host maps its own service and registers no interceptor, so
// ErrorInterceptor (registered by OrdersHost's file) does not wrap Ping.
public sealed class PingService : Pinger.PingerBase
{
    public override Task<Reply> Ping(Query q, ServerCallContext c) => Task.FromResult(new Reply());
}

public static class PingHost
{
    public static void Configure(IServiceCollection services, WebApplication app)
    {
        services.AddGrpc();
        app.MapGrpcService<PingService>();
    }
}
