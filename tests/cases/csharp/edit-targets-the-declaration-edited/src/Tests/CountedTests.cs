using App;
using Xunit;

namespace Tests
{
    public class CountedTests
    {
        [Fact]
        public void Counted()
        {
            new Callers().Counted(new Job());
        }
    }
}
