using System.Net.Http;
using System.Threading.Tasks;

namespace Depot.Checks;

public static class Shared
{
    public static HttpClient Client { get; } = new HttpClient();
    public static readonly HttpClient Field = new HttpClient();
    public static string Name { get; } = "depot";
}

public class Holder
{
    public HttpClient Http { get; set; }
}

public class DepotChecks
{
    private readonly Holder _holder = new Holder();

    // a static property, read inline and through a var
    public Task Inline() => Shared.Client.GetAsync("/health");
    public Task Local() { var c = Shared.Client; return c.GetAsync("/stats"); }
    // control: the same property through a local declared HttpClient already linked
    public Task Typed() { HttpClient c = Shared.Client; return c.GetAsync("/count"); }
    // a static field, and an instance property of a field
    public Task StaticField() => Shared.Field.GetAsync("/version");
    public Task Nested() => _holder.Http.GetAsync("/ready");
    // control: a string property is not a client
    public int NotAClient() => Shared.Name.Length;
}
