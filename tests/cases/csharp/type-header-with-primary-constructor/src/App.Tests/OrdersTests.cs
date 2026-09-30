using Xunit;

namespace Depot.App.Tests;

public class OrdersTests
{
    [Fact]
    public void CancelsAnOrder()
    {
        var c = new Orders().Cancel(3);
        Assert.Equal(3, c.OrderNumber);
    }

    [Fact]
    public void ReadsTheHost()
    {
        var m = new Mailer(new MailSettings());
        Assert.Equal("localhost", m.Host());
    }

    [Fact]
    public void MakesPlain()
    {
        Assert.NotNull(new Orders().Make());
    }
}
