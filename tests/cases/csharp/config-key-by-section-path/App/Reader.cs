using Microsoft.Extensions.Configuration;

namespace App.Widgets;

public sealed class Reader(IConfiguration config)
{
    public string? Raw() => config["Widgets:MaxCount"];
    public int Typed() => config.GetValue<int>("Widgets:MaxCount");
    public string? Min() => config["Widgets:MinCount"];
    public string? Orders() => config["Orders:MaxCount"];
}

public class Gate(Reader r)
{
    public bool Open() => r.Typed() > 0;
}
