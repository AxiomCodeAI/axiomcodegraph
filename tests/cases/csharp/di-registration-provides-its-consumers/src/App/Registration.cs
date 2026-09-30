using Microsoft.Extensions.DependencyInjection;

namespace Depot.App;

public static class Registration
{
    public static IServiceCollection AddDepot(this IServiceCollection services)
    {
        services.AddScoped<IClock, SystemClock>();
        services.AddSingleton<IFormatter, IsoFormatter>();
        return services;
    }
}
