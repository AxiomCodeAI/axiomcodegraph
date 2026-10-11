using Xunit;

namespace App.Tests;

public class XunitTests
{
    [Fact]
    public void RunByXunit() => Assert.Equal(1, 1);
}
