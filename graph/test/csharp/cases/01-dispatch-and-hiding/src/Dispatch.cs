// Virtual dispatch, and the three things that make C# dispatch different from Java.
//
// CONTROLS ARE IN THE SAME FILE ON PURPOSE. Each construct that must fan out sits
// beside one that must not, so a rule that over-fans fails here rather than looking
// like a recall win.
namespace Cases.Dispatch;

public interface IShape
{
    double Area();
    // A DEFAULT INTERFACE IMPLEMENTATION (C# 8): a real body on an interface. A type
    // that does not override it dispatches HERE, so the interface method is a target
    // rather than an abstract stub.
    string Describe() => "a shape";
}

public abstract class Shape : IShape
{
    public abstract double Area();
    // virtual WITH a body: both this and every override are targets, because a
    // concrete subclass that does not override it runs this one.
    public virtual string Name() => "shape";
    // NOT virtual. THE DEFAULT IN C#. A call on a Shape-typed receiver binds here
    // exactly, and a fan over subclasses would be wrong.
    public string Fixed() => "fixed";
}

public class Circle : Shape
{
    public override double Area() => 3.14;
    public override string Name() => "circle";
    // `new` HIDES, it does not override. A Shape-typed receiver calling Fixed()
    // reaches Shape.Fixed; only a Circle-typed receiver reaches this one.
    public new string Fixed() => "circle-fixed";
    // base.Name() is NON-VIRTUAL: exactly Shape.Name, never a fan.
    public string ViaBase() => base.Name();
}

public sealed class Square : Shape
{
    public override double Area() => 4.0;
    // Square does NOT override Name(), so a Square receiver dispatches to Shape.Name.
    // A fan that omits Shape.Name is unsound, and that omission is invisible without
    // this case.
    public sealed override string ToString() => "square";
}

public class Driver
{
    // A fan: the receiver is the abstract base, both concrete subclasses override.
    public double Fan(Shape s) => s.Area();
    // A fan that MUST include Shape.Name, because Square inherits it.
    public string FanInherited(Shape s) => s.Name();
    // EXACT: Fixed is not virtual.
    public string Exact(Shape s) => s.Fixed();
    // EXACT: a sealed class cannot be derived from.
    public double Sealed(Square q) => q.Area();
    // EXACT: the receiver was just constructed, so its runtime type is known.
    public double Fresh() => new Circle().Area();
    // An interface receiver fans over implementors, and Describe() has a default
    // body neither implementor overrides, so the interface method is the target.
    public string Iface(IShape s) => s.Describe();
}
