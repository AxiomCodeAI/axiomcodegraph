namespace Co.UnitTests.Other;

public class FullNameTests
{
    public void MatchesByFullName()
    {
        var spec = new Co.Orders.Specs.OrderFilter(3, 4);
        spec.Matches(3);
    }
}
