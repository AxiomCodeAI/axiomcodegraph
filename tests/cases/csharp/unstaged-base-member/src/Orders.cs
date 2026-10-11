namespace App.Orders;

public interface IRanked { int Rank(); }
public class OrderBase { }

public class Order : OrderBase, IComparable<Order>
{
    public int Total() => 1;
    public int CompareTo(Order? other) => 0;
}
public struct OrderKey : IEquatable<OrderKey>
{
    public int Hash() => 2;
    public bool Equals(OrderKey other) => true;
}
public class RankedOrder : OrderBase, IRanked
{
    public int Total() => 3;
    public int Rank() => 0;
}
public class Batch : List<Order>
{
    public int Size() => 4;
}

public class Caller
{
    public int Run(Order a, OrderKey k, RankedOrder r, Batch b)
        => a.Total() + k.Hash() + r.Total() + b.Size();
}
