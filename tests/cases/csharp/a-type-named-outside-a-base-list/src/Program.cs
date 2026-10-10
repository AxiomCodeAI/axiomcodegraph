var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<WidgetStore>();
builder.Services.AddScoped<IRepository<Gadget>, GadgetRepository>();
builder.Services.AddHostedService<WidgetSweeper>();
var app = builder.Build();
app.UseMiddleware<WidgetMiddleware>();
app.Run();
