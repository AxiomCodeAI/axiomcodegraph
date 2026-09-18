// HALF TWO — THE PAIR, HALF TWO OF TWO.
//
// Every method here is the method-chain equivalent of the same-named method in
// QuerySyntax.cs, computing the same value from the same data. These are the
// calls the query syntax means, written out — which is exactly what the parser
// must NOT synthesise for the other file, because which overload on which
// receiver through which extension method in which `using` scope is a
// resolution outcome (schema §2.5).
//
// Reconciling the pair is the corpus agent's job, not the parser's. What the
// pair proves is that both halves are emittable: this file's rows are ordinary
// extension-method call sites, and QuerySyntax.cs's rows are query clauses.
//
// Note what makes even this half hard: every call below is an EXTENSION method
// on IEnumerable<T>, visible only because of `using System.Linq;` at the top of
// the file. Delete that line and none of these resolve — the twin of the
// extension-visibility pair in ../extensions/.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Fixtures.CSharpOnly.Linq;

public static class MethodChain
{
    public static IEnumerable<string> NamesOfBritishCustomers() =>
        SampleData.Customers
            .Where(c => c.Country == "GB")
            .Select(c => c.Name);

    public static IEnumerable<Customer> AllCustomers() =>
        SampleData.Customers
            .Select(c => c);

    public static IEnumerable<string> TwoFilters() =>
        SampleData.Orders
            .Where(o => o.State == OrderState.Fulfilled)
            .Where(o => o.Total > 80m)
            .Select(o => o.Id.ToString());

    public static IEnumerable<Order> Ordered() =>
        SampleData.Orders
            .OrderBy(o => o.Total)
            .Select(o => o);

    public static IEnumerable<Order> OrderedDescending() =>
        SampleData.Orders
            .OrderByDescending(o => o.Total)
            .Select(o => o);

    public static IEnumerable<Order> OrderedByTwoKeys() =>
        SampleData.Orders
            .OrderBy(o => o.CustomerId)
            .ThenByDescending(o => o.PlacedOn)
            .Select(o => o);

    public static IEnumerable<string> WithLet() =>
        SampleData.Orders
            .Select(o => new { o, withVat = o.Total * 1.2m })
            .Select(t => new { t.o, t.withVat, label = $"{t.o.Id}:{t.withVat:0.00}" })
            .Where(t => t.withVat > 90m)
            .Select(t => t.label);

    public static IEnumerable<CustomerTotal> Joined() =>
        SampleData.Customers
            .Join(
                SampleData.Orders,
                c => c.Id,
                o => o.CustomerId,
                (c, o) => new CustomerTotal(c.Name, o.Total));

    public static IEnumerable<CustomerTotal> GroupJoined() =>
        SampleData.Customers
            .GroupJoin(
                SampleData.Orders,
                c => c.Id,
                o => o.CustomerId,
                (c, customerOrders) => new CustomerTotal(c.Name, customerOrders.Sum(o => o.Total)));

    public static IEnumerable<CustomerTotal> LeftOuterJoined() =>
        SampleData.Customers
            .GroupJoin(
                SampleData.Orders,
                c => c.Id,
                o => o.CustomerId,
                (c, customerOrders) => new { c, customerOrders })
            .SelectMany(
                t => t.customerOrders.DefaultIfEmpty(),
                (t, o) => new CustomerTotal(t.c.Name, o == null ? 0m : o.Total));

    public static IEnumerable<string> CrossJoin() =>
        SampleData.Customers
            .SelectMany(c => SampleData.Orders, (c, o) => new { c, o })
            .Where(t => t.o.CustomerId == t.c.Id)
            .Select(t => $"{t.c.Name}-{t.o.Id}");

    public static IEnumerable<string> NestedFrom() =>
        SampleData.Customers
            .SelectMany(c => SampleData.Orders, (c, o) => new { c, o })
            .Where(t => t.o.CustomerId == t.c.Id)
            .SelectMany(t => SampleData.Lines, (t, l) => new { t.c, t.o, l })
            .Where(t => t.l.OrderId == t.o.Id)
            .Select(t => $"{t.c.Name}:{t.l.Sku}");

    public static IEnumerable<IGrouping<string, Customer>> GroupedByCountry() =>
        SampleData.Customers
            .GroupBy(c => c.Country);

    public static IEnumerable<CountryTotal> GroupedAndAggregated() =>
        SampleData.Customers
            .Join(
                SampleData.Orders,
                c => c.Id,
                o => o.CustomerId,
                (c, o) => new { c, o })
            .GroupBy(t => t.c.Country, t => t.o)
            .Select(byCountry => new CountryTotal(
                byCountry.Key,
                byCountry.Count(),
                byCountry.Sum(o => o.Total)));

    public static IEnumerable<string> GroupedByCompositeKey() =>
        SampleData.Orders
            .GroupBy(o => new { o.CustomerId, o.State })
            .Select(g => $"{g.Key.CustomerId}/{g.Key.State}={g.Count()}");

    public static IEnumerable<string> SelectInto() =>
        SampleData.Orders
            .Select(o => new { o.Id, Net = o.Total / 1.2m })
            .Where(projected => projected.Net > 50m)
            .OrderByDescending(projected => projected.Net)
            .Select(projected => $"{projected.Id}:{projected.Net:0.00}");

    public static int CountOfQuery() =>
        SampleData.Customers
            .Where(c => c.Country != "US")
            .Select(c => c)
            .Count();

    public static IEnumerable<string> QueryOverQuery() =>
        SampleData.Customers
            .Where(c => c.JoinedOn.Year >= 2020)
            .Select(c => c.Name)
            .Where(name => name.Length > 3)
            .Select(name => name.ToUpperInvariant());

    public static IEnumerable<string> QueryInsideLambda() =>
        SampleData.Customers
            .Select(c => new
            {
                c,
                orderIds = string.Join(
                    ",",
                    SampleData.Orders.Where(o => o.CustomerId == c.Id).Select(o => o.Id))
            })
            .Select(t => $"{t.c.Name}[{t.orderIds}]");

    public static IQueryable<string> OverQueryable(IQueryable<Customer> source) =>
        source
            .Where(c => c.Country == "GB")
            .OrderBy(c => c.Name)
            .Select(c => c.Name);

    public static IEnumerable<string> ExplicitlyTypedRangeVariable(System.Collections.IEnumerable source) =>
        source
            .Cast<string>()
            .Where(s => s.Length > 0)
            .Select(s => s);

    public static IEnumerable<int> Shadowing()
    {
        int c = 100;
        var result = SampleData.Orders
            .Where(o => o.Id > c - 100)
            .Select(o => o.Id);
        return result;
    }

    // Operators that have NO query-syntax spelling at all, so this half of the
    // pair is strictly larger than the other. Any model that assumes query
    // syntax and method chains are interchangeable is wrong in this direction.
    public static IEnumerable<object> NoQuerySyntaxEquivalent() =>
        SampleData.Orders
            .Distinct()
            .Skip(1)
            .Take(2)
            .SkipWhile(o => o.Total < 10m)
            .TakeWhile(o => o.Total < 1000m)
            .Reverse()
            .Concat(SampleData.Orders.Where(o => false))
            .Union(SampleData.Orders.Take(0))
            .Except(SampleData.Orders.Take(0))
            .Intersect(SampleData.Orders)
            .DefaultIfEmpty()
            .Chunk(2)
            .SelectMany(chunk => chunk)
            .Zip(SampleData.Orders, (a, b) => new { a, b })
            .Cast<object>()
            .ToList();

    // Terminal operators — the point at which deferred execution runs.
    public static void Terminals()
    {
        _ = SampleData.Orders.ToList();
        _ = SampleData.Orders.ToArray();
        _ = SampleData.Orders.ToDictionary(o => o.Id);
        _ = SampleData.Orders.ToHashSet();
        _ = SampleData.Orders.ToLookup(o => o.CustomerId);
        _ = SampleData.Orders.First();
        _ = SampleData.Orders.FirstOrDefault();
        _ = SampleData.Orders.Single(o => o.Id == 10);
        _ = SampleData.Orders.SingleOrDefault(o => o.Id == 99);
        _ = SampleData.Orders.Last();
        _ = SampleData.Orders.ElementAt(0);
        _ = SampleData.Orders.Any();
        _ = SampleData.Orders.All(o => o.Total > 0m);
        _ = SampleData.Orders.Count();
        _ = SampleData.Orders.LongCount();
        _ = SampleData.Orders.Sum(o => o.Total);
        _ = SampleData.Orders.Min(o => o.Total);
        _ = SampleData.Orders.Max(o => o.Total);
        _ = SampleData.Orders.Average(o => o.Total);
        _ = SampleData.Orders.Aggregate(0m, (acc, o) => acc + o.Total);
        _ = SampleData.Orders.Contains(SampleData.Orders[0]);
        _ = SampleData.Orders.SequenceEqual(SampleData.Orders);
    }
}
