using App;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace App.Tests;

public class ApiFactory : WebApplicationFactory<Calc>
{
    protected override void ConfigureWebHost(object builder) { Calc.Host(1); }

    public int Helper() => Calc.Helped(1);
}

public class ApiTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public ApiTests(ApiFactory factory) { _factory = factory; }

    [Fact]
    public void UsesHelper() => Assert.Equal(18, _factory.Helper());

    [Fact]
    public void Plain() => Assert.True(true);
}
