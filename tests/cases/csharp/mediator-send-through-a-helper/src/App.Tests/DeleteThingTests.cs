using NUnit.Framework;

namespace Depot.App.Tests;

public class DeleteThingTests
{
    [Test]
    public async Task ShouldDeleteThing()
    {
        var command = new DeleteThingCommand(99);
        await TestApp.SendAsync(command);
    }

    [Test]
    public async Task ShouldCountThings()
    {
        var count = await TestApp.SendAsync(new CountThingsQuery(3));
        Assert.That(count, Is.EqualTo(3));
    }

    [Test]
    public void ShouldDescribeArchive()
    {
        var text = TestApp.Describe(new ArchiveThingCommand(1));
        Assert.That(text, Is.Not.Empty);
    }
}
