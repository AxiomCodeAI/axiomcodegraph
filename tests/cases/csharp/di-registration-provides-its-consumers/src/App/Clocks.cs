namespace Depot.App;

public interface IClock
{
    DateTime Now();
}

public interface IFormatter
{
    string Format(DateTime t);
}

public class SystemClock : IClock
{
    public SystemClock() { }

    public DateTime Now() => DateTime.UtcNow;
}

public class FixedClock : IClock
{
    public FixedClock() { }

    public DateTime Now() => DateTime.MinValue;
}

public class IsoFormatter : IFormatter
{
    public IsoFormatter() { }

    public string Format(DateTime t) => t.ToString("O");
}
