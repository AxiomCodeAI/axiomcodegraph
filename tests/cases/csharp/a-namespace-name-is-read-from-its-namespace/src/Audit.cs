namespace Shop.Audit;

using Results;

public class Auditor
{
    // `using Results;` written inside namespace Shop.Audit imports Shop.Results
    public void Describes()
    {
        var failure = new Failure("x");
        failure.Describe();
    }
}
