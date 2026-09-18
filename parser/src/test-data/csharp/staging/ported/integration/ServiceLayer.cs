// Port of java/integration/{CompleteExample,ComplexMethodsIntegration}.java —
// every ported category combined into the shape real ASP.NET code takes:
// constructor injection, an interface-typed dependency graph, generics with
// constraints, async, LINQ, exceptions, attributes and enums, all resolved
// across a file boundary.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Fixtures.Ported.Integration.Contracts;

namespace Fixtures.Ported.Integration;

// SELF-CONTAINED BY RULE. `categories/` is canonical for both blessing and
// running, and no fixture reference may cross a project boundary: a type
// reached through a ProjectReference resolves as a METADATA symbol with zero
// DeclaringSyntaxReferences, which is unadjudicable and would read as a parser
// defect that is really an artifact of partitioning. This file used to reach
// into ported/attributes/ for its attribute types; it now declares the one it
// needs as a `file`-local class, which cannot collide and cannot be referenced
// from anywhere else.
[AttributeUsage(AttributeTargets.Class)]
file sealed class ServiceAttribute : Attribute
{
    public ServiceAttribute(string name) => Name = name;

    public string Name { get; }
}

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

public sealed class ConsoleLogger<TCategory> : ILogger<TCategory>
{
    public void Log(LogLevel level, string message, Exception exception = null)
    {
        Console.WriteLine($"[{level}] {typeof(TCategory).Name}: {message}");
        if (exception != null)
        {
            Console.WriteLine(exception);
        }
    }
}

public sealed class InMemoryOrderRepository : IRepository<Order, int>, IUnitOfWork
{
    private readonly Dictionary<int, Order> store = new Dictionary<int, Order>();
    private int nextId = 1;

    public Task<Order> FindAsync(int id, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(store.TryGetValue(id, out Order found) ? found : null);
    }

    public Task<IReadOnlyList<Order>> ListAsync(CancellationToken cancellationToken = default)
    {
        IReadOnlyList<Order> all = store.Values.ToList();
        return Task.FromResult(all);
    }

    public Task AddAsync(Order entity, CancellationToken cancellationToken = default)
    {
        entity.Id = nextId++;
        store[entity.Id] = entity;
        return Task.CompletedTask;
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(store.Count);

    public void Dispose() => store.Clear();
}

[Service("order-service")]
public sealed class OrderService : IOrderService
{
    private readonly IRepository<Order, int> repository;
    private readonly IUnitOfWork unitOfWork;
    private readonly IClock clock;
    private readonly ILogger<OrderService> logger;

    public OrderService(
        IRepository<Order, int> repository,
        IUnitOfWork unitOfWork,
        IClock clock,
        ILogger<OrderService> logger)
    {
        this.repository = repository ?? throw new ArgumentNullException(nameof(repository));
        this.unitOfWork = unitOfWork ?? throw new ArgumentNullException(nameof(unitOfWork));
        this.clock = clock ?? throw new ArgumentNullException(nameof(clock));
        this.logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<OrderSummary> PlaceAsync(
        PlaceOrderCommand command,
        CancellationToken cancellationToken = default)
    {
        List<string> failures = Validate(command).ToList();
        if (failures.Count > 0)
        {
            throw new InvalidOrderException(failures);
        }

        var order = new Order
        {
            CustomerId = command.CustomerId,
            PlacedAt = clock.UtcNow,
            Status = OrderStatus.Placed
        };

        foreach (OrderLineDto line in command.Lines)
        {
            order.Lines.Add(new OrderLine
            {
                Sku = line.Sku,
                Quantity = line.Quantity,
                UnitPrice = line.UnitPrice
            });
        }

        try
        {
            await repository.AddAsync(order, cancellationToken).ConfigureAwait(false);
            await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.Log(LogLevel.Error, "failed to place order", e);
            throw new DomainException("could not place order", e);
        }

        logger.Log(LogLevel.Information, $"placed order {order.Id}");
        return Summarise(order);
    }

    public async Task<IReadOnlyList<OrderSummary>> ForCustomerAsync(
        int customerId,
        CancellationToken cancellationToken = default)
    {
        IReadOnlyList<Order> all = await repository.ListAsync(cancellationToken).ConfigureAwait(false);

        return all
            .Where(o => o.CustomerId == customerId)
            .OrderByDescending(o => o.PlacedAt)
            .ThenBy(o => o.Id)
            .Select(Summarise)
            .ToList();
    }

    private static IEnumerable<string> Validate(PlaceOrderCommand command)
    {
        if (command is null)
        {
            yield return "command is required";
            yield break;
        }

        if (command.CustomerId <= 0)
        {
            yield return "customerId must be positive";
        }

        if (command.Lines is null || command.Lines.Count == 0)
        {
            yield return "at least one line is required";
            yield break;
        }

        foreach (OrderLineDto line in command.Lines)
        {
            if (string.IsNullOrWhiteSpace(line.Sku))
            {
                yield return "sku is required";
            }

            if (line.Quantity <= 0)
            {
                yield return $"quantity for {line.Sku} must be positive";
            }
        }
    }

    private static OrderSummary Summarise(Order order) =>
        new OrderSummary(order.Id, order.CustomerId, order.Total, order.Status);
}

// A composition root, which is where the whole dependency graph appears as one
// expression.
public static class CompositionRoot
{
    public static IOrderService Build()
    {
        var repository = new InMemoryOrderRepository();
        return new OrderService(
            repository,
            repository,
            new SystemClock(),
            new ConsoleLogger<OrderService>());
    }

    public static async Task<decimal> Demonstrate(CancellationToken cancellationToken = default)
    {
        IOrderService service = Build();

        OrderSummary placed = await service.PlaceAsync(
            new PlaceOrderCommand(
                1,
                new List<OrderLineDto>
                {
                    new OrderLineDto("SKU-1", 2, 9.99m),
                    new OrderLineDto("SKU-2", 1, 19.99m)
                }),
            cancellationToken);

        IReadOnlyList<OrderSummary> forCustomer =
            await service.ForCustomerAsync(placed.CustomerId, cancellationToken);

        return forCustomer.Where(s => s.IsBillable).Sum(s => s.Total);
    }
}
