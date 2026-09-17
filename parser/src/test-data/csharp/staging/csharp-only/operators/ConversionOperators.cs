// HALF TWO — A CAST THAT INVOKES USER CODE.
//
// `(Celsius)f` looks like a type reference. It is a static method call to
// `op_Explicit`. `Celsius c = f;` has no cast syntax at all and is a static
// method call to `op_Implicit`. Both are call edges an engine must have, and
// neither has any invocation syntax.
//
// This is the C# instance of BUILDING-A-PARSER.md §4's `DECORATOR_CALL` lesson:
// a correctly-positioned row with the wrong KIND is invisible to every
// count-based check. A conversion emitted as a type reference is complete,
// correctly placed and wrong.
using System;
using System.Collections.Generic;
using System.Globalization;

namespace Fixtures.CSharpOnly.Operators;

public readonly struct Celsius
{
    public Celsius(double degrees) => Degrees = degrees;

    public double Degrees { get; }

    // IMPLICIT conversion FROM double. Every `Celsius c = 20.0;` is a call.
    public static implicit operator Celsius(double degrees) => new Celsius(degrees);

    // IMPLICIT conversion TO double. Every `double d = c;` is a call, and so is
    // every `Math.Abs(c)`, every `c + 1.0`, and every argument passed where a
    // double is expected.
    public static implicit operator double(Celsius value) => value.Degrees;

    // EXPLICIT conversion to int, which loses information and therefore must
    // be written.
    public static explicit operator int(Celsius value) => (int)value.Degrees;

    // EXPLICIT conversion between two user types.
    public static explicit operator Fahrenheit(Celsius value) =>
        new Fahrenheit((value.Degrees * 9 / 5) + 32);

    // A CHECKED explicit conversion, C# 11: a second body chosen by context.
    public static explicit operator checked int(Celsius value) => checked((int)value.Degrees);

    public override string ToString() => $"{Degrees}C";
}

public readonly struct Fahrenheit
{
    public Fahrenheit(double degrees) => Degrees = degrees;

    public double Degrees { get; }

    // The conversion in the other direction, declared on the OTHER type. C#
    // looks in both operand types for a user-defined conversion, so which type
    // declares it is not recoverable from the call site.
    public static explicit operator Celsius(Fahrenheit value) =>
        new Celsius((value.Degrees - 32) * 5 / 9);

    public static implicit operator Fahrenheit(double degrees) => new Fahrenheit(degrees);
}

// A reference type with conversions, including one to a NULLABLE and one from
// an interface-typed value.
public sealed class Text
{
    private readonly string value;

    public Text(string value) => this.value = value;

    public static implicit operator Text(string value) => new Text(value);

    public static implicit operator string(Text text) => text.value;

    public static explicit operator int(Text text) => text.value.Length;

    // A conversion whose result is NULLABLE, so the null-lifting rules apply
    // and the compiler may insert a second, generated conversion around it.
    public static implicit operator Text?(char? c) => c is null ? null : new Text(c.Value.ToString());

    public override string ToString() => value;
}

// The strongly-typed-id shape: a struct that converts implicitly to its
// underlying type and explicitly back. Every `int i = id;` in a codebase using
// this pattern is a call.
public readonly struct OrderId : IEquatable<OrderId>
{
    private readonly int value;

    private OrderId(int value) => this.value = value;

    public static OrderId From(int value) => new OrderId(value);

    public static implicit operator int(OrderId id) => id.value;

    public static explicit operator OrderId(int value) => new OrderId(value);

    public bool Equals(OrderId other) => value == other.value;

    public override bool Equals(object? obj) => obj is OrderId other && Equals(other);

    public override int GetHashCode() => value;
}

// A GENERIC type with conversions, where the conversion's operand type mentions
// the type parameter.
public readonly struct Option<T>
{
    private readonly T? value;
    private readonly bool hasValue;

    private Option(T value)
    {
        this.value = value;
        hasValue = true;
    }

    public static Option<T> Some(T value) => new Option<T>(value);

    public static Option<T> None => default;

    public static implicit operator Option<T>(T value) => Some(value);

    public static explicit operator T(Option<T> option) =>
        option.hasValue ? option.value! : throw new InvalidOperationException();

    public bool HasValue => hasValue;
}

public class ConversionCallSites
{
    // IMPLICIT conversions with NO CAST SYNTAX AT ALL. Every line below invokes
    // a user-defined static method and nothing in the source says so.
    public void ImplicitWithNoSyntax()
    {
        // Assignment.
        Celsius fromLiteral = 20.0;
        Celsius fromVariable = SomeDouble();
        double backToDouble = fromLiteral;
        Text fromString = "hello";
        string backToString = fromString;

        // ARGUMENT passing. `Consume(20.0)` calls op_Implicit then Consume.
        Consume(20.0);
        ConsumeDouble(fromLiteral);
        ConsumeText("literal");
        ConsumeString(new Text("t"));

        // RETURN position — see ReturnsCelsius below.
        Celsius returned = ReturnsCelsius();

        // COLLECTION and dictionary initialisers.
        var list = new List<Celsius> { 1.0, 2.0, 3.0 };
        var map = new Dictionary<string, Celsius> { ["a"] = 1.0 };

        // ARRAY initialiser and params.
        Celsius[] array = { 1.0, 2.0 };
        ConsumeMany(1.0, 2.0);

        // A BINARY operator whose operands need converting first.
        double sum = fromLiteral + 1.0;
        bool compared = fromLiteral > 10.0;

        // A ternary whose two arms have different types, unified by a
        // conversion.
        Celsius chosen = compared ? fromLiteral : 0.0;

        // String interpolation, which converts to object and then calls
        // ToString.
        string interpolated = $"{fromLiteral}";

        // An `is` pattern with a constant, and a switch arm — both of which may
        // route through a conversion.
        bool matched = backToDouble is > 0;

        _ = fromVariable.Degrees + backToDouble + backToString.Length + returned.Degrees
            + list.Count + map.Count + array.Length + sum + (compared ? 1 : 0)
            + chosen.Degrees + interpolated.Length + (matched ? 1 : 0);
    }

    // EXPLICIT conversions: cast syntax, user code.
    public void ExplicitWithCastSyntax()
    {
        var celsius = new Celsius(100);

        // A cast to a primitive that runs a user method.
        int truncated = (int)celsius;

        // A cast between two USER types, where the operator is declared on the
        // source type...
        Fahrenheit toF = (Fahrenheit)celsius;

        // ...and one where it is declared on the TARGET type. Identical syntax,
        // different declaring type, and the call site cannot tell.
        Celsius backToC = (Celsius)toF;

        // A cast in a CHECKED context selects the checked operator instead.
        int checkedTruncated = checked((int)celsius);

        // A cast on the result of a call, on a member access, and inside an
        // argument.
        int chained = (int)ReturnsCelsius();
        int fromMember = (int)Current;
        ConsumeInt((int)celsius);

        // A cast that is NOT a user conversion, in the same file, so the two
        // are distinguishable: a reference downcast, a boxing cast and a
        // numeric cast.
        object boxed = celsius;
        Celsius unboxed = (Celsius)boxed;
        double numeric = (double)1;
        object o = "s";
        string downcast = (string)o;

        // The strongly-typed id, in both directions.
        OrderId id = (OrderId)42;
        int asInt = id;

        // A generic conversion.
        Option<int> some = 5;
        int extracted = (int)some;

        _ = truncated + toF.Degrees + backToC.Degrees + checkedTruncated + chained
            + fromMember + unboxed.Degrees + numeric + downcast.Length + asInt
            + (some.HasValue ? 1 : 0) + extracted;
    }

    // A conversion in a `foreach`, where the enumerator's element type differs
    // from the loop variable's — the compiler inserts a conversion per
    // iteration with no syntax at all.
    public double InForeach(IEnumerable<double> source)
    {
        double total = 0;
        foreach (Celsius reading in source)
        {
            total += reading.Degrees;
        }

        return total;
    }

    // A conversion in a LINQ projection and in a lambda's return position.
    public IEnumerable<Celsius> InLinq(IEnumerable<double> source)
    {
        Func<double, Celsius> project = d => d;
        return System.Linq.Enumerable.Select(source, project);
    }

    private static double SomeDouble() => 1.0;

    private static Celsius ReturnsCelsius() => 20.0;

    private static Celsius Current => 1.0;

    private static void Consume(Celsius value)
    {
    }

    private static void ConsumeDouble(double value)
    {
    }

    private static void ConsumeText(Text value)
    {
    }

    private static void ConsumeString(string value)
    {
    }

    private static void ConsumeInt(int value)
    {
    }

    private static void ConsumeMany(params Celsius[] values)
    {
    }
}
