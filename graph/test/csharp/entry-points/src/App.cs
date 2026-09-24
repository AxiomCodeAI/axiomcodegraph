using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Hosting;
using Xunit;
using NUnit.Framework;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace App
{
    public class Program
    {
        public static void Main(string[] args) => new Worker().Run();      // main
    }

    public class NotEntry
    {
        public void Main() { }                                           // not static: not an entry point
    }

    public class Worker
    {
        public void Run() => Helper();                                   // reachable from Main
        private void Helper() { }                                        // reachable through Run
        public void Orphan() { }                                         // neither
    }

    [ApiController]
    [Route("api/orders")]
    public class OrdersController : ControllerBase
    {
        [HttpGet] public IActionResult List() => Ok();                   // http
        public string Format() => "";                                    // no route: not an entry point
    }

    public class Poller : BackgroundService
    {
        protected override Task ExecuteAsync(CancellationToken ct) => Task.CompletedTask;   // lifecycle
        public void Tick() { }                                           // not a host method
    }

    public class XunitTests
    {
        [Fact] public void Lists() { }                                   // test
        [Theory] public void Many(int x) { }                             // test
        public void NotATest() { }
    }

    public class NunitTests
    {
        [SetUp] public void Before() { }                                 // test (lifecycle)
        [Test] public void Works() { }                                   // test
    }

    [TestClass]
    public class MsTests
    {
        [TestMethodAttribute] public void Runs() { }                     // test, written with the suffix
    }
}
