// HALF TWO — the third visibility case, which the twin pair in
// ../../proj-extension-visible/ and ../../proj-extension-hidden/ does not
// cover: an extension method visible with NO `using` at all, because the
// caller is in the same namespace.
//
// Three visibility routes exist and they must be distinguishable:
//   1. a `using` of the declaring namespace          -> proj-extension-visible
//   2. no using and a different namespace            -> proj-extension-hidden (fails)
//   3. the SAME namespace, no using anywhere         -> this file
//
// Route 3 is the one that breaks a model where "the governing using set" alone
// decides visibility: here the set is empty and the call still binds.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Fixtures.CSharpOnly.Extensions;

public interface IShape
{
    double Area { get; }
}

public sealed record Circle(double Radius) : IShape
{
    public double Area => Math.PI * Radius * Radius;
}

public sealed record Rectangle(double Width, double Height) : IShape
{
    public double Area => Width * Height;
}

public static class ShapeExtensions
{
    // On an INTERFACE: every implementer gains it, including ones declared in
    // other assemblies later.
    public static string Describe(this IShape shape) => $"{shape.GetType().Name}={shape.Area:0.00}";

    // On a CONSTRUCTED generic.
    public static double TotalArea(this IEnumerable<IShape> shapes) => shapes.Sum(s => s.Area);

    // With its own type parameter and a constraint.
    public static TShape Largest<TShape>(this IEnumerable<TShape> shapes)
        where TShape : IShape
        => shapes.OrderByDescending(s => s.Area).First();

    // On a SEALED RECORD, which cannot be subclassed — extension is the only
    // way to add behaviour.
    public static Circle Grow(this Circle circle, double by) => circle with { Radius = circle.Radius + by };

    // An extension whose name COLLIDES with an instance member. The instance
    // member always wins; the extension is only reachable in static syntax.
    // This is the case an engine gets wrong if it binds by name.
    public static double GetArea(this Circle circle) => -1d;

    // An extension on `object`, which applies to everything and is the reason
    // extension lookup is scoped by `using` in the first place.
    public static string Dump(this object value) => value?.ToString() ?? "null";

    // An extension on a NULLABLE reference, callable on null.
    public static bool IsMissing(this IShape? shape) => shape is null;

    // On a type parameter, unconstrained.
    public static T OrDefault<T>(this T value, T fallback) => value is null ? fallback : value;

    // On an ARRAY and on a TUPLE.
    public static double Sum(this IShape[] shapes) => shapes.Sum(s => s.Area);

    public static double Total(this (IShape First, IShape Second) pair) => pair.First.Area + pair.Second.Area;

    // On an ENUM.
    public static bool IsRound(this ShapeKind kind) => kind == ShapeKind.Circle;

    // A `ref this` extension on a STRUCT — mutates the receiver in place. Only
    // legal on a value type, and no Java analogue whatever.
    public static void Scale(ref this Counter counter, int by) => counter.Value *= by;

    // An `in this` extension — a readonly reference receiver.
    public static int Doubled(in this Counter counter) => counter.Value * 2;
}

public enum ShapeKind
{
    Circle,
    Rectangle
}

public struct Counter
{
    public int Value;
}

public class SameNamespaceConsumer
{
    // No `using Fixtures.CSharpOnly.Extensions;` anywhere in this file, because
    // the file IS in that namespace.
    public string CallsWithNoUsing()
    {
        var circle = new Circle(1);
        var rectangle = new Rectangle(2, 3);
        IShape[] shapes = { circle, rectangle };

        string described = circle.Describe();
        double total = shapes.TotalArea();
        IShape largest = shapes.Largest();
        Circle grown = circle.Grow(1);
        string dumped = circle.Dump();
        bool missing = ((IShape?)null).IsMissing();
        string orDefault = "a".OrDefault("b");
        double summed = shapes.Sum();
        double pair = (circle, rectangle).Total();
        bool round = ShapeKind.Circle.IsRound();

        var counter = new Counter { Value = 2 };
        counter.Scale(3);
        int doubled = counter.Doubled();

        return described + total + largest.Area + grown.Radius + dumped + missing
            + orDefault + summed + pair + round + doubled;
    }

    // The instance member WINS over the same-named extension. `circle.Area` is
    // the record property; `ShapeExtensions.GetArea(circle)` is the extension,
    // and there is no receiver syntax that reaches it.
    public double InstanceMemberWins(Circle circle)
    {
        double fromInstance = circle.Area;
        double fromExtensionInStaticSyntax = ShapeExtensions.GetArea(circle);
        return fromInstance + fromExtensionInStaticSyntax;
    }

    // An extension invoked on the result of another extension, on a `new`, on
    // a literal, on a null-conditional receiver, and inside a query.
    public string Chained(IShape[] shapes)
    {
        string a = new Circle(1).Grow(1).Describe();
        string b = 42.Dump();
        string c = "text".Dump();
        IShape? maybe = shapes.Length > 0 ? shapes[0] : null;
        string d = maybe?.Describe() ?? string.Empty;
        var e = from s in shapes where !s.IsMissing() select s.Describe();
        return a + b + c + d + string.Join(",", e);
    }
}
