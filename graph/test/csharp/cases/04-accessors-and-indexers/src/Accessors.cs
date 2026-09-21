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

    // A READ-WRITE indexer, so a compound form on an indexer has both accessors to
    // call. The get-only one above is its control: `b[0] += "x"` is not expressible
    // there, which is the point -- the setter has to exist for the write half to be
    // a call rather than a compile error.
    private readonly int[] _slots = new int[4];
    public int this[string k] { get => _slots[0]; set => _slots[0] = value; }

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
    public void Increment(Base b) { b.Computed++; }    // BOTH -- `++` is not an assignment
    public void Decrement(Base b) { --b.Computed; }    // BOTH, written the other way
    public int Negate(Base b) => -b.Computed;          // THE CONTROL: `-` only reads
    public string Index(Base b) => b[0];               // the indexer's getter
    public void WriteIndex(Base b) { b["k"] = 1; }     // the indexer's setter
    public void CompoundIndex(Base b) { b["k"] += 1; } // BOTH, on an indexer
    public void StepIndex(Base b) { b["k"]++; }        // BOTH, on an indexer
    public int ArrayIndex(int[] a) => a[0];            // THE CONTROL: an array is no call

    // KNOWN DIVERGENCE (#1174), kept here because it is the only place it is visible.
    // Both of these ARE accessor calls and the oracle holds a row for each, and the
    // engine emits neither: an initializer target names a member of the type being
    // built rather than a name in scope, and `?.` nests the member access one level
    // deeper than the rule matches. Each has its control directly above -- `b.Auto =
    // "x"` and `b.Auto` -- so a repair cannot be confused with the receiver, the type
    // or the lookup. The case still passes because a property accessor is reported
    // separately rather than held; the shortfall shows as property_sites_seen.
    public Base Init() => new Base { Auto = "y" };     // set_Auto: an initializer WRITES
    public string? Maybe(Base? b) => b?.Auto;          // get_Auto, through `?.`
    public void Subscribe(Base b) { b.Changed += (s, e) => { }; }  // add_Changed

    // THE CONTROL: a plain FIELD access is not a call and must produce no edge.
    public int Field(Base b) => b.Last;
}

// A PROPERTY ACCESS WITH NO RECEIVER IS STILL A CALL. `Count` inside the declaring
// type is `this.get_Count()`, and a static one has no receiver of any kind -- neither
// is a member access, so an engine keyed on the expression's shape finds nothing and
// an oracle that switches on it asks nothing (#1170). This class is the whole
// population: read, write, compound, `++`, static, and the two names written the same
// way that are NOT calls.
public sealed class Unqualified
{
    public int Count { get; set; }
    public static int Total { get; set; }
    public int Slot;

    public int Read() => Count;                        // this.get_Count
    public void Write() { Count = 1; }                 // this.set_Count
    public void Bump() { Count += 1; }                 // BOTH
    public void Step() { Count++; }                    // BOTH
    public static int Static() => Total;               // get_Total, no receiver at all
    public int Qualified() => this.Count;              // THE CONTROL: the written form

    // THE CONTROLS: a field and a local read the same way are not calls.
    public int FieldRead() => Slot;
    public int ParamRead(int count) => count;
}
