using System.Collections.Generic;
using App;
using Xunit;

namespace App.Tests
{
    public class DispatchTests
    {
        [Fact]
        public void Saves()
        {
            Assert.NotNull(Dispatch.Run("OnSave", new Dictionary<string, object>()));
        }
    }
}
