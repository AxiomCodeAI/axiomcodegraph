var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHostedService<App.Workers.WidgetWorker>();
builder.Build().Run();
