namespace App;

public sealed class CatalogEndpoint
{
    public void AddRoute(IEndpointRouteBuilder app)
    {
        app.MapGet("api/widgets", (ItemStore s) => Handle(s));
    }
    public IResult Handle(ItemStore s) => Results.Ok(s.LoadAll());
}

public sealed class ItemStore
{
    public string[] LoadAll() => new[] { "a" };
}

public sealed class WidgetView
{
    public string ApiLink { get; set; } = "";
}
