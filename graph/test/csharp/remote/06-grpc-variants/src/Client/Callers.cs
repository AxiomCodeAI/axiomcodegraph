using System.Threading.Tasks;
using Grpc.Net.Client;
using Grpc.Net.ClientFactory;
using Depot.Rpc;

namespace Depot.Client
{
    public class FactoryCaller
    {
        private readonly GrpcClientFactory _factory;
        public FactoryCaller(GrpcClientFactory factory) { _factory = factory; }

        // a client from the factory, held in a var and used inline
        public void Place()
        {
            var client = _factory.CreateClient<Orders.OrdersClient>("orders");
            client.Place(new Request());
        }
        public void Cancel() => _factory.CreateClient<Orders.OrdersClient>("orders").Cancel(new Request());
    }

    public class ChannelCaller
    {
        private readonly GrpcChannel _ch;
        public ChannelCaller(GrpcChannel ch) { _ch = ch; }

        // an inline new, and the same through a var
        public void Quote() => new Pricing.PricingClient(_ch).Quote(new Request());
        public void Refund()
        {
            var client = new Pricing.PricingClient(_ch);
            client.Refund(new Request());
        }
        public void Reserve(Stock.StockClient s) => s.Reserve(new Request());
        public void Amend(Orders.OrdersClient o) => o.Amend(new Request());
    }
}

namespace Widgets.Client
{
    using Widgets.Rpc;

    // Registry resolves to Widgets.Rpc.Registry, never Gadgets.Rpc.Registry
    public class WidgetCaller
    {
        public void Run(Registry.RegistryClient client) => client.Lookup(new Request());
    }
}
