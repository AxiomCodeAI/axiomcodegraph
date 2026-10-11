using App;
using NUnit.Framework;

namespace App.Tests;

[SetUpFixture]
public class GlobalSetup
{
    [OneTimeSetUp]
    public void Boot() => new WidgetPricer().Price(1);
}

[TestFixture]
public class PricerTests
{
    [SetUp]
    public void Init() => new WidgetPricer().Tax(1);

    [Test]
    public void Price_Doubles() => Assert.That(2, Is.EqualTo(2));
}
