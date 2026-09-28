using System.Threading.Tasks;
using Moq;
using NSubstitute;
using Shop;
using VerifyXunit;
using Xunit;

namespace Shop.Tests;

public class MoqStubTests
{
    private readonly Mock<Prices> _prices = new Mock<Prices>();

    public MoqStubTests()
    {
        _prices.Setup(p => p.Price(1)).Returns(5);
    }

    [Fact]
    public void StubsInTheConstructor()
    {
        Assert.NotNull(_prices.Object);
    }

    [Fact]
    public void VerifiesTheStub()
    {
        _prices.Verify(p => p.Price(1));
    }
}

public class SubstituteStubTests
{
    private readonly Prices _prices = Substitute.For<Prices>();

    [Fact]
    public void StubsWithReturns()
    {
        _prices.Price(Ids.First()).Returns(4);
        _prices.Received().Price(2);
    }
}

public class RealPriceTests
{
    [Fact]
    public void RunsThePrice()
    {
        Assert.Equal(2, new Prices().Price(1));
    }

    [Fact]
    public void TotalsWithTheRealPrice()
    {
        Assert.Equal(3, new Checkout(new Prices()).Total(1));
    }
}

public class CheckoutWithMockTests
{
    private readonly Mock<Prices> _prices = new Mock<Prices>();

    [Fact]
    public void TotalsWithAMockedPrice()
    {
        Assert.Equal(1, new Checkout(_prices.Object).Total(1));
    }
}

public class SnapshotTests
{
    [Fact]
    public async Task VerifiesASnapshot()
    {
        await Verifier.Verify(new Prices().Price(3));
    }
}
