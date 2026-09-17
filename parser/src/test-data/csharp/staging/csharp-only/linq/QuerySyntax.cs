// HALF TWO — no Java analogue. THE PAIR, HALF ONE OF TWO.
//
// Every method in this file has a same-named twin in MethodChain.cs computing
// the same value from the same data. The pair IS the fixture: whatever the
// schema ruled about desugaring, the two must be reconcilable, and the ruling
// (schema §2.5) is that query clauses get a WRAPPER NODE with the clause kind
// in a column and NO synthesised Where()/Select() call edges.
//
// The load-bearing observation: this file contains query syntax whose semantics
// are two to five method calls, and there is NO CALL SYNTAX HERE AT ALL. A fact
// base that emits nothing for these methods says LINQ-heavy code calls nothing.
//
// Every clause form appears: from, from-from (SelectMany), let, where, join,
// join-into, orderby with ascending/descending and multiple keys, select,
// group-by, group-by-into, and a query continuation with `into`.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Fixtures.CSharpOnly.Linq;

public static class QuerySyntax
{
    // from / where / select — the minimal query.
    public static IEnumerable<string> NamesOfBritishCustomers() =>
        from c in SampleData.Customers
        where c.Country == "GB"
        select c.Name;

    // select of a whole element, so the projection is the identity.
    public static IEnumerable<Customer> AllCustomers() =>
        from c in SampleData.Customers
        select c;

    // Two where clauses, which desugar to two Where calls, not one.
    public static IEnumerable<string> TwoFilters() =>
        from o in SampleData.Orders
        where o.State == OrderState.Fulfilled
        where o.Total > 80m
        select o.Id.ToString();

    // orderby with one key, then with a descending key, then with two keys.
    public static IEnumerable<Order> Ordered() =>
        from o in SampleData.Orders
        orderby o.Total
        select o;

    public static IEnumerable<Order> OrderedDescending() =>
        from o in SampleData.Orders
        orderby o.Total descending
        select o;

    public static IEnumerable<Order> OrderedByTwoKeys() =>
        from o in SampleData.Orders
        orderby o.CustomerId ascending, o.PlacedOn descending
        select o;

    // let — introduces a range variable computed from the others.
    public static IEnumerable<string> WithLet() =>
        from o in SampleData.Orders
        let withVat = o.Total * 1.2m
        let label = $"{o.Id}:{withVat:0.00}"
        where withVat > 90m
        select label;

    // join — an inner join on a key pair.
    public static IEnumerable<CustomerTotal> Joined() =>
        from c in SampleData.Customers
        join o in SampleData.Orders on c.Id equals o.CustomerId
        select new CustomerTotal(c.Name, o.Total);

    // join ... into — a GROUP JOIN, which is a different operator entirely.
    public static IEnumerable<CustomerTotal> GroupJoined() =>
        from c in SampleData.Customers
        join o in SampleData.Orders on c.Id equals o.CustomerId into customerOrders
        select new CustomerTotal(c.Name, customerOrders.Sum(o => o.Total));

    // The left-outer-join idiom: group join, then from ... DefaultIfEmpty.
    public static IEnumerable<CustomerTotal> LeftOuterJoined() =>
        from c in SampleData.Customers
        join o in SampleData.Orders on c.Id equals o.CustomerId into customerOrders
        from o in customerOrders.DefaultIfEmpty()
        select new CustomerTotal(c.Name, o == null ? 0m : o.Total);

    // Two `from` clauses — SelectMany with a result selector.
    public static IEnumerable<string> CrossJoin() =>
        from c in SampleData.Customers
        from o in SampleData.Orders
        where o.CustomerId == c.Id
        select $"{c.Name}-{o.Id}";

    // Three `from` clauses over a nested collection.
    public static IEnumerable<string> NestedFrom() =>
        from c in SampleData.Customers
        from o in SampleData.Orders
        where o.CustomerId == c.Id
        from l in SampleData.Lines
        where l.OrderId == o.Id
        select $"{c.Name}:{l.Sku}";

    // group ... by — the result is a sequence of groupings, not of elements.
    public static IEnumerable<IGrouping<string, Customer>> GroupedByCountry() =>
        from c in SampleData.Customers
        group c by c.Country;

    // group ... by ... into — a query continuation over the groups.
    public static IEnumerable<CountryTotal> GroupedAndAggregated() =>
        from c in SampleData.Customers
        join o in SampleData.Orders on c.Id equals o.CustomerId
        group o by c.Country into byCountry
        select new CountryTotal(byCountry.Key, byCountry.Count(), byCountry.Sum(o => o.Total));

    // group by a COMPOSITE key.
    public static IEnumerable<string> GroupedByCompositeKey() =>
        from o in SampleData.Orders
        group o by new { o.CustomerId, o.State } into g
        select $"{g.Key.CustomerId}/{g.Key.State}={g.Count()}";

    // `select ... into` — a continuation, which starts a fresh query over the
    // projection and drops the earlier range variables from scope.
    public static IEnumerable<string> SelectInto() =>
        from o in SampleData.Orders
        select new { o.Id, Net = o.Total / 1.2m }
        into projected
        where projected.Net > 50m
        orderby projected.Net descending
        select $"{projected.Id}:{projected.Net:0.00}";

    // A query used as an EXPRESSION inside another expression, and one whose
    // source is itself a query.
    public static int CountOfQuery() =>
        (from c in SampleData.Customers where c.Country != "US" select c).Count();

    public static IEnumerable<string> QueryOverQuery() =>
        from name in
            from c in SampleData.Customers
            where c.JoinedOn.Year >= 2020
            select c.Name
        where name.Length > 3
        select name.ToUpperInvariant();

    // A query inside a lambda inside a query.
    public static IEnumerable<string> QueryInsideLambda() =>
        from c in SampleData.Customers
        let orderIds = string.Join(",", from o in SampleData.Orders where o.CustomerId == c.Id select o.Id)
        select $"{c.Name}[{orderIds}]";

    // A query over a query PROVIDER (IQueryable) rather than IEnumerable: the
    // same syntax, but the lambdas become expression trees and the calls happen
    // in a database. The syntax cannot tell you which.
    public static IQueryable<string> OverQueryable(IQueryable<Customer> source) =>
        from c in source
        where c.Country == "GB"
        orderby c.Name
        select c.Name;

    // Explicitly typed range variable — a cast on the source element.
    public static IEnumerable<string> ExplicitlyTypedRangeVariable(System.Collections.IEnumerable source) =>
        from string s in source
        where s.Length > 0
        select s;

    // A query whose range variable shadows an outer local.
    public static IEnumerable<int> Shadowing()
    {
        int c = 100;
        var result = from o in SampleData.Orders
                     where o.Id > c - 100
                     select o.Id;
        return result;
    }
}
