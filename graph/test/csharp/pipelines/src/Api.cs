using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Shop;

// Endpoint filters: by type on a group, by type on one endpoint, by instance on one endpoint.
public sealed class TenantFilter : IEndpointFilter
{
    public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext c, EndpointFilterDelegate next) => next(c);
}

public sealed class IdempotencyFilter : IEndpointFilter
{
    public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext c, EndpointFilterDelegate next) => next(c);
}

public sealed class NonEmptyFilter(string name) : IEndpointFilter
{
    public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext c, EndpointFilterDelegate next) => next(c);
}

// CONTROL: an endpoint filter nobody registers has no registered caller and wraps nothing.
public sealed class UnusedFilter : IEndpointFilter
{
    public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext c, EndpointFilterDelegate next) => next(c);
}

public static class OrderEndpoints
{
    public static RouteGroupBuilder MapOrders(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/orders").WithTags("Orders").AddEndpointFilter<TenantFilter>();
        group.MapPost("/", Create).AddEndpointFilter<IdempotencyFilter>();
        group.MapGet("/{id}", Get).AddEndpointFilter(new NonEmptyFilter("id"));
        var lines = group.MapGroup("/{id}/lines");
        lines.MapGet("/", Lines);
        // CONTROL: a sibling group with no filter; none of the filters above wraps Health.
        routes.MapGroup("/health").MapGet("/", Health);
        return group;
    }

    static string Create() => "created";
    static string Get(string id) => id;
    static string Lines(string id) => id;
    static string Health() => "ok";
}
