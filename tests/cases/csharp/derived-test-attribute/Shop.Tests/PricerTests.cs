using System;
using Shop;
using Xunit;

namespace Shop.Tests;

public class SlowFactAttribute : FactAttribute { }

public sealed class NightlyFactAttribute : SlowFactAttribute { }

[AttributeUsage(AttributeTargets.Method)]
public sealed class AuditedAttribute : Attribute { }

public class PricerTests
{
    [SlowFact]
    public void PricesSlowly() => new Pricer().Price(2);

    [NightlyFact]
    public void SweepsNightly() => new Pricer().Sweep(2);

    [Audited]
    public void AuditTrail() => new Pricer().Audit(2);

    [Fact]
    public void TaxesPlainly() => new Pricer().Tax(2);
}
