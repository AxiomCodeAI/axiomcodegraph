using System.Threading.Tasks;
using RabbitMQ.Client;
using MassTransit;
using Contracts;

namespace Producer
{
    // RabbitMQ 7: the channel comes from the connection into a var, and the default
    // exchange is written string.Empty
    public class ModernRabbit
    {
        private readonly IConnection _connection;
        public ModernRabbit(IConnection connection) { _connection = connection; }

        public async Task Audit(byte[] body)
        {
            using var channel = await _connection.CreateChannelAsync();
            await channel.BasicPublishAsync(exchange: string.Empty, routingKey: "audit", body: body);
        }
    }

    // MassTransit: the message type as a type argument with an anonymous object, and a
    // request client whose own type argument is the request
    public class ModernBus
    {
        private readonly MassTransit.IRequestClient<StockChanged> _stock;
        public ModernBus(MassTransit.IRequestClient<StockChanged> stock) { _stock = stock; }

        public Task Placed(ConsumeContext context) => context.Publish<OrderPlaced>(new { OrderId = 7 });
        public Task Ask() => _stock.GetResponse<string>(new { Sku = 1 });
    }
}
