var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddHostedService<App.SweepWorker>();
builder.Build().Run();
