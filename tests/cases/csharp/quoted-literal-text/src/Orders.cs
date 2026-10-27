namespace App;

public class Orders
{
    public const string Key = "a \"b\" c";
    public const string Plain = "a plain value";
    public const string Verbatim = @"say ""hi"" now";
    public const string RawKey = """order.created""";
    public const string Raw = """raw "x" here""";
    public const string Raw4 = """"a "" b"""";

    string Send(string subject) => subject;

    [Route("/orders/{code}")]
    public string NotifyLate() => Send("Order \"Foo\" Is Late");

    public string Resolve() => Send("The order has shipped");

    public int LabelWidth() => "header".Length;
}
