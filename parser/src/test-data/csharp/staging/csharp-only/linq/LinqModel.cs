// The data model both halves of the LINQ pair are written against, in its own
// file so that neither half is the one that also declares its types.
using System;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.Linq;

public sealed record Customer(int Id, string Name, string Country, DateOnly JoinedOn);

public sealed record Order(int Id, int CustomerId, decimal Total, DateOnly PlacedOn, OrderState State);

public sealed record OrderLine(int OrderId, string Sku, int Quantity, decimal UnitPrice);

public enum OrderState
{
    Draft,
    Placed,
    Fulfilled,
    Cancelled
}

public sealed record CustomerTotal(string Name, decimal Total);

public sealed record CountryTotal(string Country, int Customers, decimal Total);

public static class SampleData
{
    public static IReadOnlyList<Customer> Customers { get; } = new List<Customer>
    {
        new Customer(1, "Ada", "GB", new DateOnly(2020, 1, 1)),
        new Customer(2, "Grace", "US", new DateOnly(2021, 6, 1)),
        new Customer(3, "Edsger", "NL", new DateOnly(2019, 3, 1))
    };

    public static IReadOnlyList<Order> Orders { get; } = new List<Order>
    {
        new Order(10, 1, 100m, new DateOnly(2023, 1, 5), OrderState.Fulfilled),
        new Order(11, 1, 50m, new DateOnly(2023, 2, 5), OrderState.Cancelled),
        new Order(12, 2, 250m, new DateOnly(2023, 1, 9), OrderState.Placed),
        new Order(13, 3, 75m, new DateOnly(2023, 4, 1), OrderState.Fulfilled)
    };

    public static IReadOnlyList<OrderLine> Lines { get; } = new List<OrderLine>
    {
        new OrderLine(10, "SKU-A", 2, 25m),
        new OrderLine(10, "SKU-B", 1, 50m),
        new OrderLine(12, "SKU-A", 5, 50m),
        new OrderLine(13, "SKU-C", 3, 25m)
    };
}
