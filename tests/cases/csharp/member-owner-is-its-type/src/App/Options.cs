namespace App;

public sealed class AuditOptions
{
    public const string SectionName = "Audit";
    public bool Enabled { get; set; }
    public int Limit;
}

public sealed class RetryOptions
{
    public const string SectionName = "Retry";
    public bool Enabled { get; set; }
    public int Limit;
}

public static class Limits
{
    public sealed class Inner
    {
        public int Cap;
    }

    public static int Read(Inner i) => i.Cap;
}
