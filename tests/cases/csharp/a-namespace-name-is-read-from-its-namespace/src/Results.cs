namespace Shop.Results;

public class Failure
{
    public Failure(string message) { Message = message; }
    public string Message { get; }
    public string Describe() { return Message; }
}
