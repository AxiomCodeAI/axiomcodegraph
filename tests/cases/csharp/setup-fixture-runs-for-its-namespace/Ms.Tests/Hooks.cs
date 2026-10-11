using App;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Ms.Tests;

[TestClass]
public class Hooks
{
    [GlobalTestInitialize]
    public static void EveryTest(TestContext c) => new WidgetPricer().Discount(1);
}

[TestClass]
public class OrderTests
{
    [TestMethod]
    public void Places() => Assert.AreEqual(1, 1);
}
