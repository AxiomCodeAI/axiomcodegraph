namespace App;

public class HttpPatchAttribute : System.Attribute
{
    public HttpPatchAttribute(string template) { }
}

public class OrdersController
{
    [HttpPatch("{orderId}/cancel")]
    public int CancelOrder(int orderId)
    {
        return orderId;
    }

    public decimal Total(int quantity, decimal price)
    {
        return price * quantity;
    }
}

public class Caller
{
    public int Run(OrdersController c)
    {
        return c.CancelOrder(1) + (int)c.Total(2m, 3);
    }
}
