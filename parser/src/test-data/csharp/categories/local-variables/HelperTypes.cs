// Port of java/local-variables/HelperTypes.java — the support types the local
// variable fixtures are typed by, in their own file so that
// CrossFileLocalVariables.cs must follow a real cross-file edge.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.LocalVariables.Support;

public interface IRepository<TEntity, TKey>
{
    TEntity Find(TKey key);

    IReadOnlyList<TEntity> All();
}

public class Customer
{
    public int Id { get; set; }

    public string Name { get; set; }

    public Address BillingAddress { get; set; }

    public List<Order> Orders { get; set; } = new List<Order>();
}

public class Address
{
    public string Line1 { get; set; }

    public string PostCode { get; set; }
}

public class Order
{
    public int Id { get; set; }

    public decimal Total { get; set; }

    public OrderStatus Status { get; set; }
}

public enum OrderStatus
{
    Draft,
    Placed,
    Fulfilled
}

public struct Money
{
    public Money(decimal amount, string currency)
    {
        Amount = amount;
        Currency = currency;
    }

    public decimal Amount { get; }

    public string Currency { get; }
}

public delegate decimal Discount(decimal subtotal);

public class CustomerRepository : IRepository<Customer, int>
{
    private readonly Dictionary<int, Customer> store = new Dictionary<int, Customer>();

    public Customer Find(int key) => store.TryGetValue(key, out Customer found) ? found : null;

    public IReadOnlyList<Customer> All() => new List<Customer>(store.Values);
}

public static class Factories
{
    public static Customer NewCustomer(int id) => new Customer { Id = id, Name = "c" + id };

    public static Tuple<int, string> LegacyTuple() => Tuple.Create(1, "one");

    public static (int Id, string Name) ValueTuple() => (1, "one");
}
