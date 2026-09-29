// A call on the result of a generic METHOD whose return type is the method's own
// type parameter (#1549). `T Dep<T>()` returns a T, a reference to a type parameter
// resolves to no type, and the call's type argument was never put in its place, so
// `_p.Dep<Widget>().Spin()` was labelled external:T.Spin and Widget.Spin lost the
// caller. The type argument is written at the call or inferred from the argument
// passed to a parameter declared `T`; both are asserted.
//
// EVERY ASSERTION IS A CALL on the returned value, so a wrong substitution is a
// disagreement in the headline number rather than an unscored property read.
using System.Collections.Generic;

namespace Cases.GenericMethodReturn;

public class Widget
{
    public int Spin() => 1;
    public int Mark() => 10;      // same name as Gadget.Mark: crossed positions disagree
    public void Clear() { }       // same name as List<T>.Clear
}

public class Gadget
{
    public int Mark() => 2;
}

public class Provider
{
    public T Dep<T>() where T : new() => new T();
    public T Echo<T>(T value) => value;
    public T Pick<T>(int n, T value) => value;
    public TFirst First<TFirst, TSecond>() where TFirst : new() => new TFirst();
    public TSecond Second<TFirst, TSecond>() where TSecond : new() => new TSecond();
    public TOut Convert<TIn, TOut>(TIn input) where TOut : new() => new TOut();
    public List<T> Wrap<T>(T value) => new List<T> { value };
    public Widget Plain() => new Widget();
}

public static class Factory
{
    public static T Make<T>() where T : new() => new T();
}

// A non-generic twin: same name, same parameter types. C# prefers it over the
// generic one when both are applicable with identical parameter types.
public class Twin
{
    public T Echo<T>(T value) => value;
    public Widget Echo(Gadget g) => new Widget();
}

// A generic method of a generic TYPE: the method's parameter is position 0 of the
// METHOD's list, not of the type's.
public class Store<TKey>
{
    public TValue Get<TValue>(TKey key) where TValue : new() => new TValue();
}

public class Runner
{
    private readonly Provider _p = new Provider();

    // explicit type argument
    public int Explicit() => _p.Dep<Widget>().Spin();
    public int ViaLocal() { var w = _p.Dep<Widget>(); return w.Spin(); }
    public int Static() => Factory.Make<Widget>().Spin();
    public int OnGenericType(Store<string> s) => s.Get<Widget>("k").Spin();

    // inferred from the argument, at ordinal 0 and at ordinal 1
    public int Inferred() => _p.Echo(new Widget()).Spin();
    public int InferredFromLocal() { var g = new Gadget(); return _p.Echo(g).Mark(); }
    public int InferredSecond() => _p.Pick(1, new Gadget()).Mark();

    // a type argument that is itself a constrained type parameter
    public int Constrained<TW>() where TW : Widget, new() => _p.Dep<TW>().Spin();

    // CONTROL: two type parameters must not cross. Each call names Mark on the
    // other type, so a swapped position is a wrong edge, not a missing one.
    public int FirstOfTwo() => _p.First<Gadget, Widget>().Mark();
    public int SecondOfTwo() => _p.Second<Widget, Gadget>().Mark();
    // CONTROL: the return is TOut, the argument fills TIn. Explicit arguments only.
    public int Converted(Widget w) => _p.Convert<Widget, Gadget>(w).Mark();

    // CONTROL: the non-generic twin wins, so the result is a Widget. Inferring T
    // from the argument would add Gadget.Mark beside Widget.Mark.
    public int TwinWins(Twin t) => t.Echo(new Gadget()).Mark();

    // CONTROL: List<T> HAS the parameter and is not it. Typing the result as the
    // element would resolve this to Widget.Clear.
    public void ListReturn() => _p.Wrap(new Widget()).Clear();

    // CONTROL: a non-generic method, which resolved before.
    public int Control() => _p.Plain().Spin();
}

// An unqualified call from inside the declaring type.
public class SelfUser
{
    private T Build<T>() where T : new() => new T();
    public int Unqualified() => Build<Widget>().Spin();
}
