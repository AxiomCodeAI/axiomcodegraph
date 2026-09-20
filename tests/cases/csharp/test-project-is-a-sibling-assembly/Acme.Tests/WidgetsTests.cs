using Acme;

namespace Acme.Tests
{
    public class WidgetsTests
    {
        [Fact]
        public void TotalAddsExtra()
        {
            var w = new Widgets();
            Assert.Equal(3, w.Total(3));
        }
    }
}
