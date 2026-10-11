using Microsoft.Extensions.DependencyInjection;
using App.Orders;

var services = new ServiceCollection();
services.AddScoped<IOrderJob, NightlyJob>();
services.AddSingleton<Worker>();
using var sp = services.BuildServiceProvider();

var job = sp.GetRequiredService<IOrderJob>();
job.Run();
sp.GetRequiredService<Worker>().Start();
var maybe = sp.GetService<Worker>();
maybe.Stop();
