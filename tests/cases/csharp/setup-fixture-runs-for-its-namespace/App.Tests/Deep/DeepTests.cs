using NUnit.Framework;

namespace App.Tests.Deep;

public class DeepTests
{
    [Test]
    public void Nested() => Assert.That(1, Is.EqualTo(1));
}
