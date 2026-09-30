namespace Co.UnitTests.Specs;

public class OrderFilter
{
    public void MatchesExpected()
    {
        var spec = new Orders.Specs.OrderFilter(1, 2);
        spec.Matches(1);
    }
}
