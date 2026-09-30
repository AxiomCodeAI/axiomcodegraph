using MediatR;
using Microsoft.Extensions.DependencyInjection;

namespace Depot.App.Tests;

public static class TestApp
{
    public static IServiceScopeFactory ScopeFactory = null!;

    public static async Task<TResponse> SendAsync<TResponse>(IRequest<TResponse> request)
    {
        using var scope = ScopeFactory.CreateScope();
        var mediator = scope.ServiceProvider.GetRequiredService<ISender>();
        return await mediator.Send(request);
    }

    public static async Task SendAsync(IBaseRequest request)
    {
        using var scope = ScopeFactory.CreateScope();
        var mediator = scope.ServiceProvider.GetRequiredService<ISender>();
        await mediator.Send(request);
    }

    public static string Describe(IBaseRequest request)
    {
        return request.ToString() ?? "";
    }
}
