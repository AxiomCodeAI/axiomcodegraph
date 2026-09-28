namespace App;

public class Cart { }

public class Order
{
    public int Id;
    public override int GetHashCode() => Id;
}

public static class Retry
{
    public static int Tests(int n) => n;
    public static void Call() { }
}
