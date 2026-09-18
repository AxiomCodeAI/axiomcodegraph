// HALF TWO — PATTERN MATCHING, every pattern form C# 12 has.
//
// Java 21 has a subset (type, record, guarded); C# has eleven forms and they
// COMPOSE, so a parser that flattens a pattern into its parts loses the tree.
// BUILDING-A-PARSER.md §3 records exactly this defect from Python:
// `case cls.SHORT:` flattened to two NAME_REFERENCEs with no ATTRIBUTE_ACCESS.
//
// The forms, in the order they appear below:
//   constant · null · type · declaration · var · discard · relational ·
//   logical (and/or/not) · property · positional · list/slice · parenthesised
using System;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.Patterns;

public abstract record Shape;

public sealed record Circle(double Radius) : Shape;

public sealed record Rect(double Width, double Height) : Shape;

public sealed record Triangle(double A, double B, double C) : Shape;

public sealed class Point
{
    public Point(int x, int y)
    {
        X = x;
        Y = y;
    }

    public int X { get; }

    public int Y { get; }

    // A Deconstruct method makes POSITIONAL patterns available on a non-record.
    public void Deconstruct(out int x, out int y)
    {
        x = X;
        y = Y;
    }
}

public sealed class Order
{
    public required Customer Buyer { get; init; }

    public decimal Total { get; init; }

    public string? Coupon { get; init; }

    public IReadOnlyList<string> Skus { get; init; } = Array.Empty<string>();
}

public sealed class Customer
{
    public required string Country { get; init; }

    public Address? Billing { get; init; }
}

public sealed class Address
{
    public required string PostCode { get; init; }
}

public class PatternForms
{
    // CONSTANT patterns: literal, const, enum member and a qualified member
    // access as the constant — the case Python flattened.
    public const int Threshold = 10;

    public string ConstantPatterns(int value) => value switch
    {
        0 => "zero",
        1 => "one",
        -1 => "minus one",
        Threshold => "threshold",
        int.MaxValue => "max",
        DayOfWeekCodes.Monday => "monday",
        _ => "other"
    };

    private static class DayOfWeekCodes
    {
        public const int Monday = 100;
    }

    // NULL and NOT NULL patterns.
    public string NullPatterns(object? value) => value switch
    {
        null => "null",
        not null => "something"
    };

    // TYPE patterns, with and without a designation, and DISCARD.
    public string TypePatterns(object value) => value switch
    {
        int => "an int, unbound",
        string s => "a string of " + s.Length,
        Circle c => "circle " + c.Radius,
        Shape => "some other shape",
        IEnumerable<int> xs => "sequence",
        _ => "unmatched"
    };

    // VAR pattern: always matches, binds, and can carry a guard.
    public string VarPattern(object? value) => value switch
    {
        var v when v is null => "null via var",
        var v when v.GetHashCode() > 0 => "positive hash",
        var v => v.GetType().Name
    };

    // RELATIONAL patterns and their combination.
    public string RelationalPatterns(int value) => value switch
    {
        < 0 => "negative",
        0 => "zero",
        > 0 and < 10 => "small",
        >= 10 and <= 100 => "medium",
        > 100 => "large"
    };

    public string RelationalOnOtherTypes(double d, char c, decimal m, DateTime t) =>
        (d, c, m) switch
        {
            ( > 0.0, >= 'a' and <= 'z', > 0m) => "all positive",
            ( <= 0.0, _, _) => "non-positive double",
            _ => t > DateTime.UnixEpoch ? "after epoch" : "other"
        };

    // LOGICAL patterns: and, or, not, and the precedence between them.
    public string LogicalPatterns(object? value) => value switch
    {
        int and > 0 => "positive int",
        int or long or short or byte => "some integer",
        not (int or string) => "neither int nor string",
        string and not "" and { Length: < 10 } => "short non-empty string",
        _ => "other"
    };

    // PROPERTY patterns, including nested ones, ones with a type, ones with a
    // designation, and one on a nested null-able property.
    public string PropertyPatterns(Order order) => order switch
    {
        { Total: 0m } => "free",
        { Total: > 1000m, Buyer.Country: "GB" } => "big british order",
        { Buyer: { Country: "US" } } => "us order",
        { Buyer.Billing.PostCode: "SW1A 1AA" } => "downing street",
        { Buyer.Billing: null } => "no billing address",
        { Coupon: not null and { Length: > 3 } coupon } => "coupon " + coupon,
        { Skus.Count: 0 } => "empty",
        { Skus: [var only] } => "single " + only,
        Order o when o.Total < 0m => "refund",
        _ => "ordinary"
    };

    // POSITIONAL patterns: on records (synthesised Deconstruct), on a class
    // with a hand-written Deconstruct, on a tuple, and nested to two levels.
    public string PositionalPatterns(Shape shape) => shape switch
    {
        Circle(0) => "point circle",
        Circle( > 0 and < 1) => "tiny circle",
        Circle(var r) => "circle " + r,
        Rect(var w, var h) when w == h => "square",
        Rect(0, _) or Rect(_, 0) => "degenerate",
        Rect { Width: var w2, Height: var h2 } => $"rect {w2}x{h2}",
        Triangle(var a, var b, var c) when a + b <= c => "impossible",
        Triangle => "triangle",
        _ => "unknown"
    };

    public string PositionalOnClass(Point p) => p switch
    {
        (0, 0) => "origin",
        (var x, 0) => "on x axis at " + x,
        (0, var y) => "on y axis at " + y,
        ( > 0, > 0) => "first quadrant",
        _ => "elsewhere"
    };

    public string PositionalOnTuple((int Id, string Name) value) => value switch
    {
        (0, _) => "no id",
        (_, null or "") => "no name",
        (var id, var name) when name.Length > id => "long name",
        _ => "ordinary"
    };

    public string NestedPositional(Shape outer, Shape inner) => (outer, inner) switch
    {
        (Circle(var r1), Circle(var r2)) when r1 > r2 => "outer bigger",
        (Circle, Rect(var w, _)) => "circle then rect " + w,
        (Rect(var w1, var h1), Rect(var w2, var h2)) => $"{w1 * h1} vs {w2 * h2}",
        _ => "mixed"
    };

    // LIST patterns and SLICE patterns (C# 11), including a slice with a
    // designation and nested patterns inside the list.
    public string ListPatterns(int[] values) => values switch
    {
        [] => "empty",
        [var only] => "one: " + only,
        [var first, var second] => $"two: {first},{second}",
        [0, .., 0] => "zero bookends",
        [var head, .. var tail] when tail.Length > 2 => $"head {head}, {tail.Length} more",
        [.., var last] => "ends with " + last,
        _ => "other"
    };

    public string ListOfPatterns(Shape[] shapes) => shapes switch
    {
        [Circle(var r)] => "one circle " + r,
        [Circle, Rect, ..] => "circle then rect",
        [.., Triangle(_, _, var c)] => "ends with triangle side " + c,
        [_, _, _, ..] => "three or more",
        _ => "other"
    };

    public string ListOnString(string text) => text switch
    {
        [] => "empty",
        ['a', ..] => "starts with a",
        [.., 'z'] => "ends with z",
        [var only] => "single " + only,
        _ => "other"
    };

    public string ListOnSpan(ReadOnlySpan<char> text) => text switch
    {
        [] => "empty",
        ['#', .. var rest] => "comment: " + rest.Length,
        _ => "other"
    };

    // PARENTHESISED patterns, which exist only to override precedence.
    public string ParenthesisedPatterns(object value) => value switch
    {
        (int or long) and not 0 => "nonzero integer",
        not (null or "") => "not empty-ish",
        _ => "other"
    };

    // `is` patterns in EXPRESSION position: every form above is also legal here.
    public bool IsPatterns(object? value, Order order, int[] data)
    {
        bool a = value is null;
        bool b = value is not null;
        bool c = value is int;
        bool d = value is int n && n > 0;
        bool e = value is > 0 and < 10;
        bool f = value is string { Length: > 0 };
        bool g = order is { Total: > 0m, Buyer.Country: "GB" };
        bool h = data is [1, 2, ..];
        bool i = value is Circle(var r) && r > 0;
        bool j = value is not (int or string);
        bool k = value is var _;
        return a || b || c || d || e || f || g || h || i || j || k;
    }

    // Patterns in a switch STATEMENT, which is a different construct from the
    // expression and keeps `case`/`when`/`break`.
    public int SwitchStatementPatterns(object value)
    {
        switch (value)
        {
            case null:
                return 0;

            case int n when n < 0:
                return -n;

            case int n:
                return n;

            case string { Length: 0 }:
            case string { Length: > 100 }:
                return -1;

            case string s:
                return s.Length;

            case Circle(var r) when r > 10:
                return (int)r;

            case Rect(var w, var h):
                return (int)(w * h);

            case int[] { Length: > 0 } and [var first, ..]:
                return first;

            case var other:
                return other.GetHashCode();
        }
    }

    // EXHAUSTIVENESS. A switch expression over a closed hierarchy with no
    // discard arm compiles with a warning if the compiler cannot prove
    // completeness — and here the abstract record plus sealed subtypes means it
    // can almost prove it. The `_` arm is what stops CS8509.
    public double Area(Shape shape) => shape switch
    {
        Circle(var r) => Math.PI * r * r,
        Rect(var w, var h) => w * h,
        Triangle(var a, var b, var c) => Heron(a, b, c),
        _ => throw new ArgumentOutOfRangeException(nameof(shape))
    };

    private static double Heron(double a, double b, double c)
    {
        double s = (a + b + c) / 2;
        return Math.Sqrt(s * (s - a) * (s - b) * (s - c));
    }

    // A switch expression nested in a switch expression arm, and one used as
    // an argument, a receiver and an interpolation hole — the positions where a
    // non-emitting parent has swallowed subtrees in other front ends.
    public string Nested(Shape shape, int mode)
    {
        string inner = mode switch
        {
            0 => shape switch
            {
                Circle => "c",
                _ => "x"
            },
            _ => "n"
        };

        Console.WriteLine(shape switch { Circle => 1, _ => 0 });
        int length = (shape switch { Circle => "circle", _ => "other" }).Length;
        string interpolated = $"{shape switch { Circle => 1, _ => 0 }}";

        return inner + length + interpolated;
    }
}
