using Moq;
using Xunit;

namespace Depot.App.Tests;

public class ReporterTests
{
    private readonly Mock<IClock> _clock = new Mock<IClock>();

    [Fact]
    public void StampsWithAMockedClock()
    {
        var r = new Reporter(_clock.Object);
        Assert.NotNull(r.Stamp());
    }
}

public class ReporterWithRealClockTests
{
    [Fact]
    public void StampsWithTheSystemClock()
    {
        var r = new Reporter(new SystemClock());
        Assert.NotNull(r.Stamp());
    }
}
