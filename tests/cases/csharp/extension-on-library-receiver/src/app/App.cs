using Example.Kit;
namespace App.Orders;
public class Order { public int Count { get; set; } }
public static class OrderExtensions
{
    public static string Describe(this Report r) => Format(r.Count);
    public static void Check<T>(this IBuilder<T> b) => Audit();
    public static string Label(this Order o) => Format(o.Count);
    public static string Tag(this Order o) => "o";
    static string Format(int n) => n.ToString();
    static void Audit() { }
}
public static class Program
{
    public static void Main() { Kit.Run().Describe(); Kit.For<int>().Check(); new Order().Label(); }
    public static void NotAnOrder() { Kit.Run().Tag(); }
}
