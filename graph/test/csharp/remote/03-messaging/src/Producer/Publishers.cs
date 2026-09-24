using System.Threading.Tasks;
using Confluent.Kafka;
using RabbitMQ.Client;
using Azure.Messaging.ServiceBus;
using MassTransit;
using NServiceBus;
using MediatR;
using Contracts;

namespace Producer
{
    public class KafkaPublisher
    {
        private readonly IProducer<string, string> _producer;
        public KafkaPublisher(IProducer<string, string> producer) { _producer = producer; }

        public Task Placed(string json) => _producer.ProduceAsync("orders.placed", new Message<string, string> { Value = json });
        // a topic nothing in this tree consumes
        public void Metrics(string json) => _producer.Produce("metrics.raw", new Message<string, string> { Value = json });
        // a topic built at run time
        public Task Dynamic(string topic, string json) => _producer.ProduceAsync(topic, new Message<string, string> { Value = json });
    }

    public class RabbitPublisher
    {
        private const string Exchange = "shop";
        private readonly IModel _channel;
        public RabbitPublisher(IModel channel) { _channel = channel; }

        // through an exchange: the binding decides the queue
        public void Shipped(byte[] body) => _channel.BasicPublish(Exchange, "order.shipped", null, body);
        // the default exchange routes by queue name
        public void Audit(byte[] body) => _channel.BasicPublish("", "audit", null, body);
        // a fanout exchange: every bound queue gets it, whatever the key
        public void Broadcast(byte[] body) => _channel.BasicPublish("events", "any.key", null, body);
    }

    public class ServiceBusPublisher
    {
        private readonly ServiceBusClient _client;
        public ServiceBusPublisher(ServiceBusClient client) { _client = client; }

        public async Task Stock(string json)
        {
            var sender = _client.CreateSender("stock-changes");
            await sender.SendMessageAsync(new ServiceBusMessage(json));
        }
    }

    public class BusPublishers
    {
        private readonly IPublishEndpoint _publish;
        private readonly IMessageSession _session;
        private readonly IMediator _mediator;
        public BusPublishers(IPublishEndpoint publish, IMessageSession session, IMediator mediator)
        { _publish = publish; _session = session; _mediator = mediator; }

        // MassTransit: the message TYPE is the destination
        public Task Placed(int id) => _publish.Publish(new OrderPlaced { OrderId = id });
        // NServiceBus
        public Task Report() => _session.Send(new ReportRequested());
        // MediatR is in-process: not a cross-process send, whatever its method is called
        public Task Local(int id) => _mediator.Publish(new OrderShipped { OrderId = id });
    }
}
