namespace Co.Orders.Specs;

public class OrderFilter
{
    private readonly int _status;
    private readonly int _kind;

    public OrderFilter(int status, int kind)
    {
        _status = status;
        _kind = kind;
    }

    public bool Matches(int status) => status == _status;
}
