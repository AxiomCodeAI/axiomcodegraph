using Moq;
using Moq.Protected;
using NSubstitute;
using Shop;
using Xunit;

namespace Shop.Tests;

public class PriceRuleTests
{
    [Fact] public void MoqWithRate() => Assert.Equal(2m, new Mock<PriceRule>(2m) { CallBase = true }.Object.Rate);
    [Fact] public void PartsOfWithRate() => Assert.Equal(2m, Substitute.ForPartsOf<PriceRule>(2m).Rate);
    [Fact] public void DirectWithRate() => Assert.Equal(2m, new PriceRule(2m).Rate);
    [Fact] public void MoqWithFloor() => Assert.Equal(3m, new Mock<PriceRule>(MockBehavior.Loose, 2m, 1m).Object.Rate);
    [Fact] public void MoqFromLambda() => Assert.Equal(4m, new Mock<PriceRule>(() => new PriceRule(4m, 0m)).Object.Rate);

    [Fact]
    public void FeeIsStubbed()
    {
        var rule = new Mock<PriceRule>(1m) { CallBase = true };
        rule.Protected().Setup<decimal>("Fee").Returns(0m);
        rule.Protected().Verify<decimal>("Fee", Times.Never());
        rule.Protected()
            .Setup<System.Threading.Tasks.Task<decimal>>("Tip");
    }
}
