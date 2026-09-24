namespace Contracts
{
    public class OrderPlaced { public int OrderId { get; set; } }
    public class OrderShipped { public int OrderId { get; set; } }
    public class OrderAudited { public int OrderId { get; set; } }
    public class StockChanged { public int Sku { get; set; } }
    public class ReportRequested { }
}
