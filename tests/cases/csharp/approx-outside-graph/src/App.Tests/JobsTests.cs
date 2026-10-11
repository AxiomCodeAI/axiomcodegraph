using Xunit;

namespace App.Tests
{
    public class JobsTests
    {
        [Fact]
        public void PurgeIsNotRun()
        {
            var script = "purge.sh";
            new App.Jobs().Restock(1);
        }

        [Fact]
        public void Message()
        {
            var m = "stock went negative";
        }
    }
}
