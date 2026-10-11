using App;
using Xunit;

namespace Tests
{
    public class OtherTests
    {
        [Fact]
        public void Other()
        {
            new Callers().Other(new Task());
        }
    }
}
