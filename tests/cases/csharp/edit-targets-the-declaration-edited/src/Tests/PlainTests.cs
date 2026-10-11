using App;
using Xunit;

namespace Tests
{
    public class PlainTests
    {
        [Fact]
        public void Plain()
        {
            new Callers().Plain(new Job());
        }
    }
}
