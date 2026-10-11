using System.Collections.Generic;
using Moq;
using NSubstitute;
using Xunit;

namespace App
{
    public interface IPricer { decimal Price(decimal a); }

    public class PriceRule
    {
        public PriceRule(decimal rate) { Rate = rate; }
        public PriceRule(decimal rate, decimal floor) { Rate = rate + floor; }
        public virtual decimal Rate { get; }
    }

    public class Plain { public virtual int N() => 1; }

    public static class Other { public static T ForPartsOf<T>(params object[] a) => default!; }

    public class PriceRuleTests
    {
        // a class mock runs the constructor its arguments select (#1495)
        [Fact] public void MoqOne() => Assert.Equal(2m, new Mock<PriceRule>(2m) { CallBase = true }.Object.Rate);
        [Fact] public void MoqBehaviorTwo() => Assert.Equal(3m, new Mock<PriceRule>(MockBehavior.Loose, 2m, 1m).Object.Rate);
        [Fact] public void PartsOfOne() => Assert.Equal(2m, Substitute.ForPartsOf<PriceRule>(2m).Rate);
        [Fact] public void ForTwo() => Assert.Equal(3m, Substitute.For<PriceRule>(2m, 1m).Rate);

        // controls: an interface mock has no constructor to run; a mock built from a lambda runs the lambda's
        // own `new` (a call of its own, not this hop); a type with only its implicit constructor; a generic
        // collection that is not a mock; a ForPartsOf on a receiver that is not NSubstitute's
        [Fact] public void InterfaceMock() => Assert.NotNull(new Mock<IPricer>().Object);
        [Fact] public void LambdaMock() => Assert.NotNull(new Mock<PriceRule>(() => new PriceRule(3m)).Object);
        [Fact] public void ImplicitCtor() => Assert.NotNull(new Mock<Plain>().Object);
        [Fact] public void NotAMock() => Assert.NotNull(new List<PriceRule>(4));
        [Fact] public void OtherFactory() => Assert.Null(Other.ForPartsOf<PriceRule>(2m));
    }
}
