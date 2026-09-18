// In C# most member access IS a call. `x.Name` invokes get_Name, `a[i]` invokes an
// indexer accessor, `e += h` invokes add_E. A Java-shaped engine reads them as field
// accesses and emits nothing, which on a real codebase loses more call sites than it
// finds.
namespace Cases.Accessors;

public class Base
{
    // An auto-property: its accessors have NO BODY. The edge into them is real -- it
    // is what the runtime calls -- and there is nothing further to walk into. That is
    // the correct answer, not a gap.
    public string Auto { get; set; } = "";

    // A property with real bodies, and virtual, so its getter is DISPATCHED.
    public virtual int Computed
    {
        get { return 1; }
        set { Last = value; }
    }

    public int Last;

    // An indexer: `a[i]` is a call to this, and on an array it is not a call at all.
    public string this[int i] => i.ToString();

    public event System.EventHandler? Changed;
    public void Raise() => Changed?.Invoke(this, System.EventArgs.Empty);
}

public sealed class Derived : Base
{
    public override int Computed
    {
        get { return 2; }
        set { Last = value * 2; }
    }
}

public sealed class Driver
{
    public string Read(Base b) => b.Auto;              // get_Auto
    public void Write(Base b) => b.Auto = "x";         // set_Auto
    public int ReadVirtual(Base b) => b.Computed;      // FANS: Base and Derived
    public void WriteVirtual(Base b) { b.Computed = 3; }
    public void Compound(Base b) { b.Computed += 1; }  // BOTH get and set
    public string Index(Base b) => b[0];               // the indexer's getter
    public void Subscribe(Base b) { b.Changed += (s, e) => { }; }  // add_Changed

    // THE CONTROL: a plain FIELD access is not a call and must produce no edge.
    public int Field(Base b) => b.Last;
}
