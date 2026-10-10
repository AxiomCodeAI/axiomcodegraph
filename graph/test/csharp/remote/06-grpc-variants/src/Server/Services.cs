using System.Threading.Tasks;
using Grpc.Core;
using static Depot.Rpc.Orders;

namespace Depot.Rpc
{
    // the base written after `using static`
    public class OrdersService : OrdersBase
    {
        public override Task<Reply> Place(Request r, ServerCallContext c) => null;
        public override Task<Reply> Cancel(Request r, ServerCallContext c) => null;
        public override Task<Reply> Amend(Request r, ServerCallContext c) => null;
    }

    // the base reached through a project base class
    public abstract class AuditedStockBase : Stock.StockBase
    {
        public void Audit() { }
    }
    public class StockService : AuditedStockBase
    {
        public override Task<Reply> Reserve(Request r, ServerCallContext c) => null;
    }

    public class PricingService : Pricing.PricingBase
    {
        public override Task<Reply> Quote(Request r, ServerCallContext c) => null;
        public override Task<Reply> Refund(Request r, ServerCallContext c) => null;
    }
}

// two services called Registry, in two namespaces
namespace Widgets.Rpc
{
    public class WidgetRegistry : Registry.RegistryBase
    {
        public override Task<Reply> Lookup(Request r, ServerCallContext c) => null;
    }
}
namespace Gadgets.Rpc
{
    public class GadgetRegistry : Registry.RegistryBase
    {
        public override Task<Reply> Lookup(Request r, ServerCallContext c) => null;
    }
}
