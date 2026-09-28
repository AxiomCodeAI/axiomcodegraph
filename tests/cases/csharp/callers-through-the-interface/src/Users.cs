namespace App;

public class OrderService
{
    private readonly IStore _store;

    public OrderService(IStore store)
    {
        _store = store;
    }

    public void Place()
    {
        _store.Save("k");
    }
}

public class SelfMade
{
    public void Place()
    {
        new SqlStore().Save("k");
    }
}

public class ShapeUser
{
    public double Total(IShape s)
    {
        return s.Area();
    }

    public double SquareOnly(Square sq)
    {
        return sq.Area();
    }
}
