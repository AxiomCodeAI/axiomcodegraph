namespace Zed.Tests;

public class Unrelated
{
    public void NotInScope()
    {
        var spec = new Orders.Specs.OrderFilter(7, 8);
        spec.Matches(7);
    }
}
