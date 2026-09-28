using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace App.Pages;

public sealed class Ledger { public int Count() => 1; public void Add() { } public void Close() { } public void Flush() { } }

// Razor Pages: the handlers a request runs, directly and through the project's own base
public class OrdersModel(Ledger l) : PageModel
{
    public void OnGet() => l.Count();
    public Task<IActionResult> OnPostCancelAsync(int id) { l.Add(); return Task.FromResult<IActionResult>(Page()); }
    public int Total() => l.Count();                             // control: not a handler name
    private void OnGetHidden() { }                               // control: private, not a handler
}
public abstract class AppPage : PageModel { }
public class ItemsModel : AppPage { public void OnGetAsync() { } }

// MediatR: the mediator calls these in process
public record GetOrder(int Id) : IRequest<int>;
public record OrderPlaced(int Id) : INotification;
public class GetOrderHandler(Ledger l) : IRequestHandler<GetOrder, int>
{
    public Task<int> Handle(GetOrder request, CancellationToken ct) => Task.FromResult(l.Count());
}
public class OrderPlacedHandler : INotificationHandler<OrderPlaced>
{
    public Task Handle(OrderPlaced n, CancellationToken ct) => Task.CompletedTask;
}

// Disposal: the container or a `using` calls these
public sealed class LedgerScope(Ledger l) : IDisposable, IAsyncDisposable
{
    public void Dispose() => l.Close();
    public ValueTask DisposeAsync() { l.Flush(); return ValueTask.CompletedTask; }
}

// controls: the same names on types that derive from nothing the framework calls
public class Report
{
    public void OnGet() { }
    public Task<int> Handle(GetOrder request, CancellationToken ct) => Task.FromResult(0);
    public void Dispose() { }
    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
