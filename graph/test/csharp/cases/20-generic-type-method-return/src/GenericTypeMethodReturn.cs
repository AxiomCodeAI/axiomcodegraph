// A call on the result of a METHOD whose return type is its declaring TYPE's
// parameter (#1448). `IFactory<Store>.Create()` returns a T, the receiver's
// reference says T is Store, and nothing put Store in T's place, so
// `f.Create().Count()` was labelled external:T.Count while `f.Current.Count()`
// through a property declared `T` resolved. Case 10 pins the property and field
// substitution; this is the same set of shapes for a method's return.
//
// EVERY ASSERTION IS A CALL on the returned value, so a wrong substitution is a
// disagreement in the headline number rather than an unscored property read.
using System.Collections.Generic;

namespace Cases.GenericTypeMethodReturn;

public class Store
{
    public int Count() => 0;
    public int Mark() => 1;       // same name as Other.Mark: crossed positions disagree
    public void Clear() { }       // same name as List<T>.Clear
}

public class Other
{
    public int Mark() => 2;
}

public interface IFactory<T>
{
    T Create();
    T Current { get; }
}

public interface IPair<TFirst, TSecond>
{
    TFirst First();
    TSecond Second();
}

// A generic base holding the method, passed through, closed at the declaration,
// inherited again, closed with a DIFFERENT type, and RENAMED on the way through.
public abstract class RepoBase<T> where T : new()
{
    public T Get() => new T();
    public List<T> All() => new List<T>();
}
public sealed class Repo<T> : RepoBase<T> where T : new() { }
public class StoreRepo : RepoBase<Store>
{
    // an unqualified call on the implicit `this`, closed by the heritage clause
    public int Own() => Get().Count();
}
public sealed class DeepRepo : StoreRepo { }
public sealed class OtherRepo : RepoBase<Other> { }
public sealed class Renamed<U> : RepoBase<U> where U : new() { }

// A class implementing the interface under its OWN parameter name.
public sealed class Maker<U> : IFactory<U> where U : new()
{
    public U Create() => new U();
    public U Current { get; } = new U();
}

// CONTROL: a non-generic factory, which resolved before.
public sealed class StoreFactory
{
    public Store Create() => new Store();
}

public class Reader
{
    private readonly IFactory<Store> _factory;
    public Reader(IFactory<Store> f) { _factory = f; }

    // the receiver's own reference: a field, a parameter, locals. A `this.`-qualified
    // field has no type reference at all (the property form fails the same way), a
    // separate gap, so it is not asserted here.
    public int ViaField() => _factory.Create().Count();
    public int ViaParameter(IFactory<Store> f) => f.Create().Count();
    public int ViaLocal(IFactory<Store> f) { var s = f.Create(); return s.Count(); }
    public int ViaTypedLocal() { IFactory<Store> f = _factory; return f.Create().Count(); }
    public int ViaClass(Maker<Store> m) => m.Create().Count();

    // CONTROL: the property declared `T`, which resolved before.
    public int ViaProperty() => _factory.Current.Count();

    // CONTROL: TWO parameters. Each call names Mark on the other type, so a
    // swapped position is a wrong edge, not a missing one.
    public int PairFirst(IPair<Store, Other> p) => p.First().Mark();
    public int PairSecond(IPair<Store, Other> p) => p.Second().Mark();

    // through a generic base
    public int PassedThrough(Repo<Store> r) => r.Get().Count();
    public int ClosedHere(StoreRepo r) => r.Get().Count();
    public int TwoLevels(DeepRepo r) => r.Get().Count();
    public int RenamedBase(Renamed<Store> r) => r.Get().Count();
    // CONTROL: closed with Other, so this must reach Other.Mark and not Store.Mark.
    public int ClosedOther(OtherRepo r) => r.Get().Mark();

    // CONTROL: List<T> HAS the parameter and is not it. Typing the result as the
    // element would resolve this to Store.Clear.
    public void ListReturn(Repo<Store> r) => r.All().Clear();

    // CONTROL: a non-generic method.
    public int Plain(StoreFactory f) => f.Create().Count();
}
