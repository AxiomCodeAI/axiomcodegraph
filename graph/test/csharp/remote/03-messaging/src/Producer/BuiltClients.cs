using System;
using System.Threading.Tasks;
using Confluent.Kafka;
using RabbitMQ.Client;
using MassTransit;
using Contracts;

namespace Producer
{
    public class BuiltClients
    {
        // a producer built into a var, and the topic in a string local
        public async Task Refund(ProducerConfig config, string json)
        {
            using var producer = new ProducerBuilder<string, string>(config).Build();
            var topic = "orders.refunded";
            await producer.ProduceAsync(topic, new Message<string, string> { Value = json });
        }

        // a channel from the older factory
        public void Audit(IConnection connection, byte[] body)
        {
            var channel = connection.CreateModel();
            channel.BasicPublish("", "audit", null, body);
        }

        // the bus from GetService
        public Task Placed(IServiceProvider services)
        {
            var bus = services.GetService<IPublishEndpoint>();
            return bus.Publish(new OrderPlaced());
        }
    }
}
