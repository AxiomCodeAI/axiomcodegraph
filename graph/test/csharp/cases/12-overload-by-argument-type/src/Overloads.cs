// AN OVERLOAD IS PICKED BY ITS ARGUMENTS' TYPES, NOT ONLY BY THEIR COUNT (#1246).
// `Scale(3)`, `Scale(2.5)` and `Scale("x")` all have one argument, so arity alone
// leaves all three `Scale` overloads standing and each site reads as a three-way
// multi_inferred set. The compiler's choice is fixed by the argument's type, and
// where that type is written down (a literal, or a variable declared with a
// predefined type) the engine can make the same choice.
//
// The score against Roslyn cannot see this: a three-target set that contains the
// right target reads as agreement. tools/overload-by-argument-test.sh asserts the
// target count and tier per site instead.
//
// THE CONTROLS ARE IN THIS FILE:
//
//   1. ARITY ALONE ALREADY DECIDES `Pad(1)` / `Pad(1, 2)`. Unchanged.
//   2. AN ARGUMENT WHOSE TYPE IS NOT WRITTEN DOWN (a call's result, `var`, a named
//      argument) prunes nothing and the site stays multi_inferred.
//   3. TWO OVERLOADS THE ARGUMENT CONVERTS TO EQUALLY FROM THE ENGINE'S VIEW
//      (`Scale('c')`: char converts implicitly to int and to double) stay a set.
//      The compiler ranks int above double; the engine does not rank, it prunes.
//   4. AN INACCESSIBLE EXACT MATCH. `Formatter.F("out")` from outside binds
//      `F(object)`: the private `F(string)` is not a candidate there. Inside the
//      type, `F("in")` binds `F(string)`.
//   5. AN OVERLOAD IN A DERIVED TYPE. `d.M(3)` binds `Derived.M(double)`, because C#
//      drops a base-type candidate whenever the derived type has an applicable one.
//      An exact match in the BASE must not evict it.
namespace Cases.Overloads;

public static class MathUtil
{
    public static string Scale(int x) => "int";
    public static string Scale(double x) => "double";
    public static string Scale(string x) => "string";

    // CONTROL 1: arity decides.
    public static int Pad(int a) => a;
    public static int Pad(int a, int b) => a + b;

    // No identity match; the string overload is not applicable to a number.
    public static string Wide(long x) => "long";
    public static string Wide(string x) => "string";

    // A params array beside a fixed overload.
    public static string Log(string s) => s;
    public static string Log(params object[] xs) => "many";

    // An optional parameter: the compiler prefers the overload that needs no default.
    public static int Opt(int a) => a;
    public static int Opt(int a, int b = 0) => a + b;

    // A generic overload: an exact non-generic match wins, and a string goes to T.
    public static string G<T>(T x) => "T";
    public static string G(int x) => "int";

    public static int Compute() => 7;

    // Unqualified, from inside the declaring type.
    public static string Self() => Scale(4) + Scale("self");
}

public static class Formatter
{
    private static string F(string s) => s;
    public static string F(object o) => "object";
    public static string Inner() => F("in");
}

public class Shape
{
    public virtual string Area(int x) => "shape int";
    public virtual string Area(string x) => "shape string";
}

public class Circle : Shape
{
    public override string Area(int x) => "circle int";
    public override string Area(string x) => "circle string";
}

// Through an interface, implemented once implicitly and once explicitly. The fan of
// `K(int)` must not carry either type's `K(string)`.
public interface IKeyed
{
    string K(int x);
    string K(string x);
}

public class Implicit : IKeyed
{
    public string K(int x) => "implicit int";
    public string K(string x) => "implicit string";
}

public class Explicit : IKeyed
{
    string IKeyed.K(int x) => "explicit int";
    string IKeyed.K(string x) => "explicit string";
}

public class Base
{
    public string M(int x) => "base int";
}

public class Derived : Base
{
    public string M(double x) => "derived double";
}

public static class Program
{
    public static string Literals()
    {
        return MathUtil.Scale(3) + MathUtil.Scale(2.5) + MathUtil.Scale("x")
             + MathUtil.Scale(3L) + MathUtil.Scale(2.5f) + MathUtil.Scale(@"v");
    }

    public static string Declared(int i, string s)
    {
        double d = 1.5;
        return MathUtil.Scale(i) + MathUtil.Scale(s) + MathUtil.Scale(d);
    }

    public static string Pruned()
    {
        return MathUtil.Wide(3) + MathUtil.Wide("w") + MathUtil.Log("one") + MathUtil.Log(1)
             + MathUtil.Opt(1) + MathUtil.G(3) + MathUtil.G("g");
    }

    public static string Dispatched(Shape shape)
    {
        return shape.Area(1) + shape.Area("a");
    }

    public static string ThroughInterface(IKeyed k) => k.K(1) + k.K("k");

    public static int Arity() => MathUtil.Pad(1) + MathUtil.Pad(1, 2);

    public static string Unknown()
    {
        var v = 3;
        return MathUtil.Scale(MathUtil.Compute()) + MathUtil.Scale(v) + MathUtil.Scale(x: 3)
             + MathUtil.Scale('c');
    }

    public static string Hidden(Derived d) => d.M(3);

    public static string Private() => Formatter.F("out");
}
