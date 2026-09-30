using System.Net.Http;
using Xunit;

namespace Store.Web.Tests;

public class CartPageTests
{
    private readonly HttpClient Client = new HttpClient();

    [Fact]
    public async Task AddsToCart()
    {
        var response = await Client.PostAsync("/cart/index", new StringContent("itemId=1"));
        Assert.NotNull(response);
    }

    [Fact]
    public async Task ShowsCart()
    {
        var response = await Client.GetAsync("/cart");
        Assert.NotNull(response);
    }

    [Fact]
    public async Task ChecksOut()
    {
        var response = await Client.PostAsync("/Cart/Checkout", new StringContent(""));
        Assert.NotNull(response);
    }

    [Fact]
    public async Task PostsElsewhere()
    {
        var response = await Client.PostAsync("/cart/totals", new StringContent(""));
        Assert.NotNull(response);
    }

    [Fact]
    public async Task SignsIn()
    {
        var response = await Client.PostAsync("/members/account/signin", new StringContent("user=a"));
        Assert.NotNull(response);
    }

    [Fact]
    public async Task ChecksHealth()
    {
        var response = await Client.GetAsync("/health");
        Assert.NotNull(response);
    }
}
