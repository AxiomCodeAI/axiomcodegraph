using Grpc.Core;
using Grpc.Core.Interceptors;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

namespace Shop;

public sealed class ErrorInterceptor : Interceptor
{
    public override Task<TRes> UnaryServerHandler<TReq, TRes>(TReq q, ServerCallContext c, UnaryServerMethod<TReq, TRes> h) => h(q, c);
}

// A client interceptor, added to a generated client's builder.
public sealed class CorrelationInterceptor : Interceptor
{
    public override AsyncUnaryCall<TRes> AsyncUnaryCall<TReq, TRes>(TReq q, ClientInterceptorContext<TReq, TRes> c,
        AsyncUnaryCallContinuation<TReq, TRes> next) => next(q, c);
}

// CONTROL: an interceptor put in a plain list is not registered with any host.
public sealed class ListedInterceptor : Interceptor
{
    public override Task<TRes> UnaryServerHandler<TReq, TRes>(TReq q, ServerCallContext c, UnaryServerMethod<TReq, TRes> h) => h(q, c);
}

public sealed class StockService : Stock.StockBase
{
    public override Task<Reply> Check(Query q, ServerCallContext c) => Task.FromResult(new Reply());
    // CONTROL: a helper beside the rpcs is not one, so the interceptor does not wrap it.
    public int Helper() => 1;
}

public static class OrdersHost
{
    public static void Configure(IServiceCollection services, WebApplication app)
    {
        services.AddGrpc(o => o.Interceptors.Add<ErrorInterceptor>());
        services.AddGrpcClient<Stock.StockClient>().AddInterceptor<CorrelationInterceptor>();
        app.MapGrpcService<StockService>();
        var list = new List<Interceptor>();
        list.Add(new ListedInterceptor());
    }
}
