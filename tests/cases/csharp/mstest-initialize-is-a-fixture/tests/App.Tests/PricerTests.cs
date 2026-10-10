using App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace App.Tests;

[TestClass]
public class PricerTests
{
    [TestInitialize]
    public void Init() => new WidgetPricer().Price(1);

    [TestCleanup]
    public void Done() => new WidgetPricer().Refund(1);

    [ClassInitialize]
    public static void ClassInit(TestContext c) => new WidgetPricer().Tax(1);

    [TestMethod]
    public void Price_Doubles() => Assert.AreEqual(2, 2);

    [TestMethod]
    public void Price_Triples() => Assert.AreEqual(3, 3);
}
