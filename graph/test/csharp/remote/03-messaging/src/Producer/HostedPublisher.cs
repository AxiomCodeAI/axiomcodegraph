using System;
using System.Threading.Tasks;
using NServiceBus;
using Contracts;

namespace Producer
{
    // the session from the service locator, and a send with an explicit address first
    public static class HostedPublisher
    {
        public static async Task Run(IServiceProvider services)
        {
            var session = services.GetRequiredService<IMessageSession>();
            await session.Send("Reports.Endpoint", new ReportRequested());
        }
    }
}
