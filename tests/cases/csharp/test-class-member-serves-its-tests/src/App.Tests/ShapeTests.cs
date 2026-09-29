using System;
using App;
using Xunit;

namespace App.Tests;

public class ShapeTests
{
    static int Scaled() => Calc.Scale(2);
    static int NeverCalled() => Calc.Unused(2);

    [Fact]
    public void AreaThroughALambda()
    {
        Func<int> area = () => Calc.Area(2, 3);
        Assert.Equal(6, area());
    }

    [Fact]
    public void PerimeterOnly()
    {
        Assert.Equal(10, Calc.Perimeter(2, 3));
    }

    [Fact]
    public void UsesHelper()
    {
        Assert.Equal(6, Scaled());
    }
}
