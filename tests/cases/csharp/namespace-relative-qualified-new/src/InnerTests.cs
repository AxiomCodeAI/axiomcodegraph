namespace Co.Tests.Deep;

public class InnerTests
{
    public void MatchesInner()
    {
        var spec = new Orders.Specs.OrderFilter(5, 6);
        spec.Matches(5);
    }
}
