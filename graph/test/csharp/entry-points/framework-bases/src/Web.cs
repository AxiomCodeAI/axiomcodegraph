using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.SignalR;

namespace App.Widgets;

public sealed class Catalog { public int Max() => 10; public int Min() => 1; public void Touch() { } }

public class WidgetListViewComponent(Catalog c) : ViewComponent
{
    public IViewComponentResult Invoke(int max) => View(c.Max());
    public int Helper() => 0;                                    // control: not a view-component method
}
public interface IWidgetClient { Task Count(int n); }
public class WidgetHub(Catalog c) : Hub<IWidgetClient>
{
    public Task Send(int count) => Clients.All.Count(c.Max() + count);
    public override Task OnConnectedAsync() { c.Touch(); return Task.CompletedTask; }
    private int Scale(int n) => n * 2;                           // control: private, not a hub method
    public static int Zero() => 0;                               // control: static, not a hub method
}
// a hub through the project's own base
public abstract class AppHub : Hub { public Task Ping() => Task.CompletedTask; }
public class StatusHub : AppHub { public Task Status() => Task.CompletedTask; }
public class OwnerRequirement : IAuthorizationRequirement { }
public class OwnerHandler : AuthorizationHandler<OwnerRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext ctx, OwnerRequirement r) => Task.CompletedTask;
}
public class WidgetBinder : IModelBinder
{
    public Task BindModelAsync(ModelBindingContext bindingContext) => Task.CompletedTask;
}
// control: the same method names on a type that derives from nothing the framework calls
public class Sampler
{
    public int Invoke(int max) => max;
    public Task BindModelAsync(ModelBindingContext bindingContext) => Task.CompletedTask;
    public Task HandleRequirementAsync(AuthorizationHandlerContext ctx, OwnerRequirement r) => Task.CompletedTask;
    public Task Send(int count) => Task.CompletedTask;
}
