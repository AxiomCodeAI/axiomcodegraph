// HALF TWO — no Java analogue. VALUE SEMANTICS ARE REAL: assignment COPIES.
//
// Java has exactly one kind of user-declared reference-free type — none. Every
// Java class is a reference type. C# structs are copied on assignment, on
// argument passing, on return and on capture, and `readonly`/`ref` change what
// may be done to them. An engine that models a struct field write as an
// aliasing write is wrong; an engine that models a struct as a reference is
// wrong about every dataflow edge through it.
using System;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.StructsRecords;

// A plain struct. No base list, no parameterless constructor before C# 10, all
// fields zero-initialised by `default`.
public struct Point
{
    public int X;
    public int Y;

    public Point(int x, int y)
    {
        X = x;
        Y = y;
    }

    // C# 10 allows an explicit parameterless constructor on a struct, and
    // `default(Point)` STILL DOES NOT CALL IT. Two ways to make an instance,
    // one of which runs no code.
    public Point()
    {
        X = -1;
        Y = -1;
    }

    public int Magnitude => X * X + Y * Y;

    public void Offset(int dx, int dy)
    {
        X += dx;
        Y += dy;
    }
}

// A READONLY STRUCT: every instance member is implicitly `readonly`, no field
// may be assigned outside a constructor, and the compiler stops making
// defensive copies.
public readonly struct Money
{
    public Money(decimal amount, string currency)
    {
        Amount = amount;
        Currency = currency;
    }

    public decimal Amount { get; }

    public string Currency { get; }

    public Money Add(in Money other) =>
        Currency == other.Currency
            ? new Money(Amount + other.Amount, Currency)
            : throw new InvalidOperationException();

    public override string ToString() => $"{Amount} {Currency}";
}

// A struct with READONLY MEMBERS on a non-readonly struct: per-member, C# 8.
public struct PartlyReadOnly
{
    public int Value;

    // `readonly` on a member promises it does not mutate `this`, which removes
    // the defensive copy at every call site through an `in` parameter.
    public readonly int Doubled() => Value * 2;

    public readonly override string ToString() => Value.ToString();

    public readonly int Computed => Value + 1;

    public void Mutate(int by) => Value += by;
}

// A REF STRUCT: stack-only. Cannot be boxed, cannot be a field of a class,
// cannot be a type argument, cannot implement an interface (before C# 13),
// cannot be captured by a lambda, cannot be an `async` local. Every one of
// those is a real engine constraint and none of them has a Java analogue.
public ref struct Cursor
{
    public Cursor(ReadOnlySpan<char> text)
    {
        Text = text;
        Position = 0;
    }

    public ReadOnlySpan<char> Text;

    public int Position;

    public bool MoveNext()
    {
        if (Position >= Text.Length)
        {
            return false;
        }

        Position++;
        return true;
    }

    public readonly char Current => Text[Position - 1];
}

public readonly ref struct ReadOnlyCursor
{
    public ReadOnlyCursor(ReadOnlySpan<byte> data) => Data = data;

    public ReadOnlySpan<byte> Data { get; }

    public int Length => Data.Length;
}

// A generic struct, a struct implementing interfaces, and a struct with an
// operator.
public struct Vector<T> : IEquatable<Vector<T>>
    where T : struct
{
    public T X;
    public T Y;

    public bool Equals(Vector<T> other) => X.Equals(other.X) && Y.Equals(other.Y);

    public override bool Equals(object? obj) => obj is Vector<T> other && Equals(other);

    public override int GetHashCode() => HashCode.Combine(X, Y);

    public static bool operator ==(Vector<T> left, Vector<T> right) => left.Equals(right);

    public static bool operator !=(Vector<T> left, Vector<T> right) => !left.Equals(right);
}

// A struct with an explicit layout — the interop shape.
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Explicit)]
public struct Union
{
    [System.Runtime.InteropServices.FieldOffset(0)]
    public int AsInt;

    [System.Runtime.InteropServices.FieldOffset(0)]
    public float AsFloat;
}

// An enum-like struct with a private constructor — the strongly-typed-id shape
// that appears throughout modern C#.
public readonly struct CustomerId : IEquatable<CustomerId>
{
    private readonly int value;

    private CustomerId(int value) => this.value = value;

    public static CustomerId From(int value) => new CustomerId(value);

    public bool Equals(CustomerId other) => value == other.value;

    public override bool Equals(object? obj) => obj is CustomerId other && Equals(other);

    public override int GetHashCode() => value;

    public static implicit operator int(CustomerId id) => id.value;
}

public class ValueSemantics
{
    private Point field = new Point(1, 1);

    private readonly Point readonlyField = new Point(2, 2);

    public Point Property { get; set; }

    // Assignment COPIES. `b` is not `a`, and mutating one does not touch the
    // other. Getting this wrong inverts every dataflow conclusion.
    public (int A, int B) CopyOnAssignment()
    {
        Point a = new Point(1, 1);
        Point b = a;
        b.X = 99;
        return (a.X, b.X);
    }

    // Passing COPIES; passing `ref` does not.
    public (int ByValue, int ByRef) CopyOnArgument()
    {
        Point byValue = new Point(1, 1);
        MutateCopy(byValue);

        Point byRef = new Point(1, 1);
        MutateAlias(ref byRef);

        return (byValue.X, byRef.X);
    }

    private static void MutateCopy(Point p) => p.X = 99;

    private static void MutateAlias(ref Point p) => p.X = 99;

    // A mutating call through a PROPERTY mutates a temporary and is silently
    // lost. This is the single most common struct bug in real C#.
    public int MutationThroughPropertyIsLost()
    {
        Property = new Point(1, 1);
        Point copy = Property;
        copy.Offset(10, 10);
        return Property.X;
    }

    // A mutating call through a READONLY FIELD also mutates a defensive copy.
    public int MutationThroughReadonlyFieldIsLost()
    {
        Point local = readonlyField;
        local.Offset(10, 10);
        return readonlyField.X;
    }

    // A mutating call through a FIELD is not lost.
    public int MutationThroughFieldSticks()
    {
        field.Offset(10, 10);
        return field.X;
    }

    // Boxing a struct: the value goes on the heap and further mutation of the
    // original does not show through the box.
    public (int, int) Boxing()
    {
        Point p = new Point(1, 1);
        object boxed = p;
        p.X = 99;
        Point unboxed = (Point)boxed;
        return (p.X, unboxed.X);
    }

    // `default` versus `new`: the explicit parameterless constructor runs for
    // one and not the other.
    public (int Defaulted, int Constructed) DefaultVersusNew()
    {
        Point defaulted = default;
        Point constructed = new Point();
        return (defaulted.X, constructed.X);
    }

    // Structs in collections: a List<Point> indexer returns a COPY, so
    // `list[0].X = 1` does not compile, while an array's does.
    public int InCollections()
    {
        var array = new Point[1];
        array[0].X = 1;

        var list = new List<Point> { new Point(0, 0) };
        Point copy = list[0];
        copy.X = 1;
        list[0] = copy;

        // A `ref` into a Span DOES alias.
        Span<Point> span = array;
        span[0].X = 2;

        return array[0].X + list[0].X;
    }

    // A ref struct cannot cross an async or iterator boundary, cannot be
    // captured and cannot be a type argument — recorded here as the set of
    // things that are ABSENT by rule.
    public int UsesRefStruct(string text)
    {
        var cursor = new Cursor(text.AsSpan());
        int count = 0;
        while (cursor.MoveNext())
        {
            count += cursor.Current;
        }

        return count;
    }
}
