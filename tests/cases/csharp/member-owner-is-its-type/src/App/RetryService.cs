namespace App;

public sealed class RetryService
{
    private readonly RetryOptions _r = new();

    public bool RetryOn() => _r.Enabled;
    public int Attempts() => _r.Limit;
    public string RetrySection() => RetryOptions.SectionName;
}
