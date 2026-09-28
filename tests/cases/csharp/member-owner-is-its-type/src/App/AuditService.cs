namespace App;

public sealed class AuditService
{
    private readonly AuditOptions _o = new();

    public bool IsOn() => _o.Enabled;
    public int Max() => _o.Limit;
    public string Section() => AuditOptions.SectionName;
    public void Enable() { _o.Enabled = true; }
    public AuditOptions Options() => _o;
}
