// Port of java/local-variables/CrossFileLocalVariables.java. Every local here
// is typed by a declaration in another file, reached through a `using`. That is
// the shape BUILDING-A-PARSER.md section 0 names as the IR-completeness case:
// the declared type NAME as written, the importing module, and the import's
// resolved file path are the three facts required, and no resolution beyond
// them.
using System;
using System.Collections.Generic;
using Fixtures.Ported.LocalVariables.Support;

namespace Fixtures.Ported.LocalVariables;

public class CrossFileLocalVariables
{
    public void TypedByAnotherFile()
    {
        Customer customer = new Customer();
        Address address = customer.BillingAddress;
        Order order = new Order();
        OrderStatus status = OrderStatus.Placed;
        Money money = new Money(1m, "GBP");
        CustomerRepository repository = new CustomerRepository();
        IRepository<Customer, int> asInterface = repository;
        Discount discount = subtotal => subtotal * 0.9m;

        var inferredCustomer = Factories.NewCustomer(1);
        var inferredTuple = Factories.ValueTuple();
        var inferredLegacyTuple = Factories.LegacyTuple();

        List<Customer> generic = new List<Customer>();
        Dictionary<int, Order> nestedGeneric = new Dictionary<int, Order>();
        IReadOnlyList<Customer> readOnlyView = repository.All();
        Customer[] array = new Customer[2];
        Customer[][] jagged = new Customer[2][];
        (Customer Owner, Order Latest) namedTuple = (customer, order);
        Customer nullableReference = null;
        Money? nullableValue = null;

        _ = address?.PostCode?.Length ?? 0;
        _ = order.Total + money.Amount;
        _ = status == OrderStatus.Placed;
        _ = asInterface.Find(1);
        _ = discount(10m);
        _ = inferredCustomer.Id + inferredTuple.Id + inferredLegacyTuple.Item1;
        _ = generic.Count + nestedGeneric.Count + readOnlyView.Count + array.Length + jagged.Length;
        _ = namedTuple.Owner.Id + namedTuple.Latest.Id;
        _ = nullableReference?.Id ?? 0;
        _ = nullableValue?.Amount ?? 0m;
    }

    // Locals typed by a type in a DIFFERENT ASSEMBLY (the BCL) — the same
    // cross-module edge, through a reference rather than a source file.
    public void TypedByAnotherAssembly()
    {
        System.Text.StringBuilder builder = new System.Text.StringBuilder();
        System.Globalization.CultureInfo culture = System.Globalization.CultureInfo.InvariantCulture;
        Uri uri = new Uri("https://example.invalid");
        TimeSpan span = TimeSpan.FromSeconds(1);
        _ = builder.Length + culture.Name.Length + uri.Host.Length + (int)span.TotalSeconds;
    }
}
