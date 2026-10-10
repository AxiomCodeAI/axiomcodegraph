using System.Collections.Generic;
using App;
using Xunit;

namespace App.Tests;

public static class ExternalCases
{
    public static IEnumerable<object[]> Rows() { Calc.External(1); return new[] { new object[] { 1 } }; }
}

public class DataTests
{
    public static IEnumerable<object[]> LocalRows() { Calc.Local(1); return new[] { new object[] { 1 } }; }

    [Theory]
    [MemberData(nameof(ExternalCases.Rows), MemberType = typeof(ExternalCases))]
    public void FromOtherType(int q) => Assert.True(q > 0);

    [Theory]
    [MemberData(nameof(LocalRows))]
    public void FromOwnType(int q) => Assert.True(q > 0);
}
