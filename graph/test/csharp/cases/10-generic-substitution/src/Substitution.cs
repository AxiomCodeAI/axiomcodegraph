// Binding a generic ARGUMENT to the PARAMETER it fills, so a member declared `T`
// has a type at the use site.
//
// Two clauses already did this for one position of one shape each: `await` takes
// argument 0 off Task<T>, and the element type takes argument 0 off a one-argument
// collection. Both are hard-coded, which is why Task<T> and IEnumerable<T> worked
// and nothing else did -- a member declared `T` kept the type parameter, so the
// access resolved and everything chained onto it had no receiver and died.
//
// EVERY ASSERTION IS A CALL, not a property read. The scorer holds a property
// accessor in a bucket that checks only that the engine emitted SOMETHING at the
// position and never compares the target, so a case written as `w.Value.Flag`
// would score identically whether the substitution were right, wrong or absent.
// Calling a method on the substituted value puts the answer in the headline number,
// where a wrong target is a disagreement and a missing one is a miss.
//
// THE CONTROLS ARE WHAT MAKE THIS SAFE. Substituting by position is one wrong index
// away from typing `Second` as the first argument, and one wrong test away from
// typing `List<T> Items` as the element. Each of those is a WRONG edge rather than
// a missing one, so each is asserted by the right answer rather than by the mere
// presence of an answer.
namespace Cases.Substitution;

public sealed class Settings { public bool Read() => true; }
public sealed class Other { public int Mark() => 1; }

public interface IWrap<T> { T Value { get; } }
public sealed class Wrap<T> : IWrap<T> { public T Value { get; } = default!; }
public sealed class Holder<T> { public T Item = default!; }          // a FIELD declared `T`
public sealed class Pair<TFirst, TSecond>
{
    public TFirst First { get; } = default!;
    public TSecond Second { get; } = default!;
}

// A member whose type merely HAS a type-parameter argument, and a member of a
// generic type whose type is not the parameter at all.
public sealed class Box<T>
{
    public System.Collections.Generic.List<T> Items { get; } = new();
    public Settings Plain { get; } = new Settings();
}

// A non-generic wrapper exposing the same shape. This separates "the property hop
// is broken" from "the substitution is missing": it resolved both hops before the
// substitution existed and must still.
public sealed class PlainWrap { public Settings Value { get; } = new Settings(); }

public sealed class Reader
{
    public bool ThroughInterface(IWrap<Settings> w) => w.Value.Read();
    public bool ThroughClass(Wrap<Settings> w) => w.Value.Read();
    public bool ViaLocal(IWrap<Settings> w) { var s = w.Value; return s.Read(); }
    public bool ThroughField(Holder<Settings> h) => h.Item.Read();

    // CONTROL: the non-generic wrapper.
    public bool NonGeneric(PlainWrap p) => p.Value.Read();

    // CONTROL: TWO parameters. Both are asserted, because crossing the positions
    // still produces two edges and would pass a test that only counted them --
    // `First` must reach Settings.Read and `Second` must reach Other.Mark.
    public bool PairFirst(Pair<Settings, Other> p) => p.First.Read();
    public int PairSecond(Pair<Settings, Other> p) => p.Second.Mark();

    // CONTROL: `Items` is a List<T>, NOT a T. Its type merely HAS the parameter as
    // an argument, and typing it as the element would make `b.Items` a Settings and
    // resolve this to Settings.Read.
    public int ListMember(Box<Settings> b) => b.Items.Count;

    // CONTROL: a member of a generic type whose type is NOT the parameter. The
    // substitution must leave it alone, and it must still resolve on its own.
    public bool PlainMember(Box<Settings> b) => b.Plain.Read();
}

// A GENERIC BASE holding the member. `class Repo<T> : RepoBase<T>` and `class
// OrderRepo : RepoBase<Order>` are how a repository, a handler and a cache are
// written, and they bind the base's parameter in two different places: the first
// passes the use site's argument along, the second closes it at the declaration and
// needs no argument at the use site at all.
//
// COMPOSED THROUGH THE HERITAGE REFERENCE, NOT BY NAME. `class D<T> : B<U>` is legal,
// so a base's parameter NAME means nothing to a derived reference. What connects them
// is the reference D writes for its base.
public abstract class WrapBase<T> { public T Value { get; } = default!; }

public sealed class PassedThrough<T> : WrapBase<T> { }          // the argument flows in
public class ClosedHere : WrapBase<Settings> { }         // closed at the declaration
public sealed class TwoLevels : ClosedHere { }                  // ...and inherited again
public sealed class OwnWrap<U> { public U Value { get; } = default!; }

// CONTROL: a base closed with a DIFFERENT type. If the two closings were confused,
// this would reach Settings.Read and that is a wrong edge rather than a missing one.
public sealed class ClosedOther : WrapBase<Other> { }

// CONTROL: a base whose parameter is RENAMED on the way through. Matching by name
// would fail here and matching through the reference must not.
public sealed class Renamed<U> : WrapBase<U> { }

public sealed class InheritanceReader
{
    public bool ReadPassedThrough(PassedThrough<Settings> w) => w.Value.Read();
    public bool ReadClosedHere(ClosedHere w) => w.Value.Read();
    public bool ReadTwoLevels(TwoLevels w) => w.Value.Read();
    public bool ReadRenamed(Renamed<Settings> w) => w.Value.Read();
    public int ReadClosedOther(ClosedOther w) => w.Value.Mark();      // must be Other, not Settings
    public bool ReadOwn(OwnWrap<Settings> w) => w.Value.Read();       // CONTROL: declared here
}
