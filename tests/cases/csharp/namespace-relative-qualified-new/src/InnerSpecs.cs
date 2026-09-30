namespace Co.Tests.Orders.Specs;

public class OrderFilter
{
    public OrderFilter(int status, int kind) { }

    public bool Matches(int status) => status == 0;
}
