namespace Depot.App;

public class Scheduler(IClock clock)
{
    public DateTime Next() => clock.Now().AddMinutes(5);
}

public class Reporter
{
    private readonly IClock _clock;

    public Reporter(IClock clock)
    {
        _clock = clock;
    }

    public string Stamp() => _clock.Now().ToString();
}

public class Printer
{
    private readonly IFormatter _formatter;

    public Printer(IFormatter formatter)
    {
        _formatter = formatter;
    }

    public string Print() => _formatter.Format(DateTime.UtcNow);
}
