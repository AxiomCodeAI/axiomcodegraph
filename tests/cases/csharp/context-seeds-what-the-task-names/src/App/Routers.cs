using System.Threading.Tasks;
namespace App;

public interface IRouter { Task<Order> RouteAsync(Cart c); }

public class FastRouter : IRouter { public Task<Order> RouteAsync(Cart c) => Task.FromResult(new Order()); }
public class SlowRouter : IRouter { public Task<Order> RouteAsync(Cart c) => Task.FromResult(new Order()); }
public class NoRouter : IRouter { public Task<Order> RouteAsync(Cart c) => Task.FromResult<Order>(null); }

public class Checkout {
    private readonly IRouter router;
    public Checkout(IRouter r) { router = r; }
    public Task<Order> Run(Cart c) => router.RouteAsync(c);
}
