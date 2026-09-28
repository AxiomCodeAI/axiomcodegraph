namespace Shop;

public class Prices
{
    public virtual int Price(int id)
    {
        return id * 2;
    }
}

public class Ids
{
    public static int First()
    {
        return 1;
    }
}

public class Checkout
{
    private readonly Prices _prices;

    public Checkout(Prices prices)
    {
        _prices = prices;
    }

    public int Total(int id)
    {
        return _prices.Price(id) + 1;
    }
}
