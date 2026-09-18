// Target-typed `new()`: the type is written NOWHERE. The parser records a
// constructor call with an empty callee name, so every one of these is unresolved
// unless the target type is recovered from context.
namespace Cases.TargetTypedNew;

public sealed class Holder
{
    public Holder() { }
    public Holder(int n) { Count = n; }
    public int Count;
}

public sealed class Driver
{
    // (a) a field initializer
    readonly Holder _field = new();
    // (b) a property initializer
    public Holder Prop { get; } = new();
    Holder _assigned;

    public Driver()
    {
        // (e) an assignment
        _assigned = new(3);
    }

    // (c) an explicitly typed local
    public int Local()
    {
        Holder h = new(1);
        return h.Count;
    }

    // (d) a return statement
    public Holder Returned() => new();

    // THE CONTROL: an explicit `new Holder()` must still resolve, and must not be
    // affected by any of the above.
    public Holder Explicit() => new Holder(2);

    public int Read() => _field.Count + Prop.Count + _assigned.Count;
}
