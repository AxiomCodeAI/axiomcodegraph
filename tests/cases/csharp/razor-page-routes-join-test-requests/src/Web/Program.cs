var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapGet("/health", Health.Check);
app.MapRazorPages();
app.Run();

public static class Health
{
    public static string Check() => "ok";
}
