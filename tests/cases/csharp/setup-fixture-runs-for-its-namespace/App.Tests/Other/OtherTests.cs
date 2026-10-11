using NUnit.Framework;

namespace Elsewhere.Tests;

public class OtherTests
{
    [Test]
    public void Outside() => Assert.That(1, Is.EqualTo(1));
}

public class XunitInSameAssembly
{
    [Xunit.Fact]
    public void NotNunit() { }
}
