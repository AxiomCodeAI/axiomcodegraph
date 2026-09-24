using System.Threading;
using System.Threading.Tasks;
using Confluent.Kafka;
using RabbitMQ.Client;
using Azure.Messaging.ServiceBus;
using MassTransit;
using NServiceBus;
using MediatR;
using Contracts;

namespace Consumer
{
    public class KafkaWorker
    {
        private readonly IConsumer<string, string> _consumer;
        public KafkaWorker(IConsumer<string, string> consumer) { _consumer = consumer; }

        // the method that subscribes is the one that handles what arrives
        public void Run(CancellationToken ct)
        {
            _consumer.Subscribe("orders.placed");
            while (!ct.IsCancellationRequested) { var r = _consumer.Consume(ct); }
        }

        // a consumer built into a var, subscribing to an array of topics
        public void RunMany(ConsumerConfig config)
        {
            using var consumer = new ConsumerBuilder<string, string>(config).Build();
            consumer.Subscribe(new[] { "orders.refunded", "orders.voided" });
        }
    }

    public class RabbitWorker
    {
        private readonly IModel _channel;
        public RabbitWorker(IModel channel) { _channel = channel; }

        public void Start(IBasicConsumer handler)
        {
            _channel.QueueBind("shipping", "shop", "order.shipped");
            _channel.BasicConsume("shipping", true, handler);
        }

        public void StartAudit(IBasicConsumer handler) => _channel.BasicConsume("audit", true, handler);

        // a server-named queue bound to the fanout exchange with an empty key
        public void Listen(IBasicConsumer handler)
        {
            var queue = _channel.QueueDeclare().QueueName;
            _channel.QueueBind(queue, "events", "");
            _channel.BasicConsume(queue, true, handler);
        }
    }

    public class ServiceBusWorker
    {
        private readonly ServiceBusClient _client;
        public ServiceBusWorker(ServiceBusClient client) { _client = client; }

        public async Task Start()
        {
            var processor = _client.CreateProcessor("stock-changes");
            processor.ProcessMessageAsync += OnStock;
            await processor.StartProcessingAsync();
        }

        private Task OnStock(ProcessMessageEventArgs args) => Task.CompletedTask;
    }

    // MassTransit
    public class OrderPlacedConsumer : IConsumer<OrderPlaced>
    {
        public Task Consume(ConsumeContext<OrderPlaced> context) => Task.CompletedTask;
    }

    // NServiceBus
    public class ReportHandler : IHandleMessages<ReportRequested>
    {
        public Task Handle(ReportRequested message, IMessageHandlerContext context) => Task.CompletedTask;
    }

    // a consumer of a message nothing here sends
    public class AuditedConsumer : IConsumer<OrderAudited>
    {
        public Task Consume(ConsumeContext<OrderAudited> context) => Task.CompletedTask;
    }

    // MediatR: in-process, never a remote destination
    public class ShippedNotification : INotificationHandler<OrderShipped>
    {
        public Task Handle(OrderShipped n, CancellationToken ct) => Task.CompletedTask;
    }
}

namespace Consumer
{
    // MassTransit: the request's consumer
    public class StockConsumer : MassTransit.IConsumer<Contracts.StockChanged>
    {
        public System.Threading.Tasks.Task Consume(MassTransit.ConsumeContext<Contracts.StockChanged> context) => System.Threading.Tasks.Task.CompletedTask;
    }
}
