// Port of the contract half of java/integration/CompleteExample.java: the
// interfaces, DTOs and exceptions that ServiceLayer.cs is written against, in
// their own file so every reference from it crosses a module boundary.
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Fixtures.Ported.Integration.Contracts;

public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

public interface ILogger<TCategory>
{
    void Log(LogLevel level, string message, Exception exception = null);
}

public enum LogLevel
{
    Trace,
    Debug,
    Information,
    Warning,
    Error
}

public interface IRepository<TEntity, TKey>
    where TEntity : class
    where TKey : notnull
{
    Task<TEntity> FindAsync(TKey id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<TEntity>> ListAsync(CancellationToken cancellationToken = default);

    Task AddAsync(TEntity entity, CancellationToken cancellationToken = default);
}

public interface IUnitOfWork : IDisposable
{
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}

public interface IOrderService
{
    Task<OrderSummary> PlaceAsync(PlaceOrderCommand command, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<OrderSummary>> ForCustomerAsync(int customerId, CancellationToken cancellationToken = default);
}

public sealed class Order
{
    public int Id { get; set; }

    public int CustomerId { get; set; }

    public DateTimeOffset PlacedAt { get; set; }

    public OrderStatus Status { get; set; }

    public List<OrderLine> Lines { get; } = new List<OrderLine>();

    public decimal Total
    {
        get
        {
            decimal total = 0m;
            foreach (OrderLine line in Lines)
            {
                total += line.UnitPrice * line.Quantity;
            }

            return total;
        }
    }
}

public sealed class OrderLine
{
    public string Sku { get; set; }

    public int Quantity { get; set; }

    public decimal UnitPrice { get; set; }
}

public enum OrderStatus
{
    Draft,
    Placed,
    Fulfilled,
    Cancelled
}

public sealed record PlaceOrderCommand(int CustomerId, IReadOnlyList<OrderLineDto> Lines);

public sealed record OrderLineDto(string Sku, int Quantity, decimal UnitPrice);

public sealed record OrderSummary(int OrderId, int CustomerId, decimal Total, OrderStatus Status)
{
    public bool IsBillable => Status is OrderStatus.Placed or OrderStatus.Fulfilled;
}

public class DomainException : Exception
{
    public DomainException(string message)
        : base(message)
    {
    }

    public DomainException(string message, Exception inner)
        : base(message, inner)
    {
    }
}

public sealed class OrderNotFoundException : DomainException
{
    public OrderNotFoundException(int id)
        : base($"order {id} was not found")
        => Id = id;

    public int Id { get; }
}

public sealed class InvalidOrderException : DomainException
{
    public InvalidOrderException(IReadOnlyList<string> failures)
        : base("order is invalid")
        => Failures = failures;

    public IReadOnlyList<string> Failures { get; }
}
