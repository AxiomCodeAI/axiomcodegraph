using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace App.Workers;

public sealed class Store { public void Save() { } public void Ship() { } public void Goodbye() { } }
public sealed class WidgetOptions { public int MaxCount { get; set; } }

public abstract class WorkerBase : BackgroundService { }
public sealed class WidgetWorker(Store s) : WorkerBase
{
    protected override Task ExecuteAsync(CancellationToken ct) { s.Save(); return Task.CompletedTask; }
}
public sealed class OrderWorker(Store s) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken ct) { s.Ship(); return Task.CompletedTask; }
}
public sealed class OrderSync(Store s) : IHostedService, IHostedLifecycleService
{
    public Task StartAsync(CancellationToken ct) => Task.CompletedTask;
    public Task StoppedAsync(CancellationToken ct) { s.Goodbye(); return Task.CompletedTask; }
    public Task StartingAsync(CancellationToken ct) => Task.CompletedTask;
    public Task StartedAsync(CancellationToken ct) => Task.CompletedTask;
    public Task StoppingAsync(CancellationToken ct) => Task.CompletedTask;
    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
public sealed class ConfigureWidgets : IConfigureOptions<WidgetOptions>
{
    public void Configure(WidgetOptions o) => o.MaxCount = 5;
}
public sealed class PostWidgets : IPostConfigureOptions<WidgetOptions>
{
    public void PostConfigure(string? name, WidgetOptions o) { }
}
public sealed class CheckWidgets : IValidateOptions<WidgetOptions>
{
    public ValidateOptionsResult Validate(string? name, WidgetOptions o) => ValidateOptionsResult.Success;
}
// control: Configure and StoppedAsync on types that implement nothing
public sealed class Tuner
{
    public void Configure(WidgetOptions o) { }
    public Task StoppedAsync(CancellationToken ct) => Task.CompletedTask;
    public Task ExecuteAsync(CancellationToken ct) => Task.CompletedTask;
}
public interface IWidgetSetup : IConfigureOptions<WidgetOptions> { }
public sealed class DefaultWidgets : IWidgetSetup
{
    public void Configure(WidgetOptions o) => o.MaxCount = 1;
}
