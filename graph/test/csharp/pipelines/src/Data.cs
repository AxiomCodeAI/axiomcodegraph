using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Shop;

public sealed class AuditInterceptor : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(DbContextEventData e, InterceptionResult<int> r) => r;
    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData e, InterceptionResult<int> r,
        CancellationToken ct = default) => base.SavingChangesAsync(e, r, ct);
}

public sealed class EventsInterceptor : SaveChangesInterceptor
{
    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData e, InterceptionResult<int> r,
        CancellationToken ct = default) => base.SavingChangesAsync(e, r, ct);
}

public interface IUnitOfWork
{
    Task<int> SaveChangesAsync(CancellationToken ct = default);
}

public abstract class AppContextBase(DbContextOptions o) : DbContext(o), IUnitOfWork { }

public sealed class OrdersDb(DbContextOptions<OrdersDb> o) : AppContextBase(o) { }

public sealed class Seeder : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken ct) => Task.CompletedTask;
}

public static class DataSetup
{
    public static void AddData(IServiceCollection services)
    {
        services.AddSingleton<EventsInterceptor>();
        services.AddDbContext<OrdersDb>((sp, o) => o.AddInterceptors(new AuditInterceptor(), sp.GetRequiredService<EventsInterceptor>()));
        services.AddHostedService<Seeder>();
    }
}

public sealed class OrderStore(OrdersDb db)
{
    public Task SaveAsync() => db.SaveChangesAsync();
    // sync save: the synchronous hooks only (AuditInterceptor.SavingChanges)
    public void Save() => db.SaveChanges();
}

public sealed class Committer(IUnitOfWork uow)
{
    // through the project's abstraction the context implements
    public Task Commit() => uow.SaveChangesAsync();
}

// CONTROL: a SaveChangesAsync on a type that is not a context runs no interceptor.
public sealed class Journal
{
    public Task SaveChangesAsync() => Task.CompletedTask;
}

public sealed class JournalWriter(Journal j)
{
    public Task Write() => j.SaveChangesAsync();
}
