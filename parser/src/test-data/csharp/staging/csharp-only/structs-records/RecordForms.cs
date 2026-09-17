// HALF TWO — records, and the members that are DECLARATIONS WITH NO
// DECLARATION SYNTAX.
//
// A positional record synthesises, from one line of source:
//   * a primary constructor with one parameter per positional member,
//   * an `init`-only public property per positional member,
//   * a `Deconstruct` method with one `out` per member,
//   * `Equals(T)`, `Equals(object)`, `GetHashCode`, `operator ==`, `operator !=`,
//   * `ToString` and the `PrintMembers` hook,
//   * a protected copy constructor, and
//   * a `<Clone>$` method that `with` calls.
//
// Every one of those is a member the parser can never see and the engine can be
// asked to resolve a call to. `record struct` synthesises the same set minus
// the copy constructor and with value equality rather than reference-plus-value.
using System;
using System.Collections.Generic;
using System.Text;

namespace Fixtures.CSharpOnly.StructsRecords;

// POSITIONAL record: one line, nine synthesised members.
public record Person(string FirstName, string LastName, int Age);

// Positional record with a BODY: the synthesised members coexist with declared
// ones, and a declared member SUPPRESSES the synthesised one of the same name.
public record Employee(string FirstName, string LastName, int Age, string Department)
{
    // An extra declared member.
    public string FullName => $"{FirstName} {LastName}";

    // Overriding a SYNTHESISED member. `ToString` would have been generated;
    // declaring it wins.
    public override string ToString() => $"{FullName} ({Department})";

    // The PrintMembers hook, which is how a record customises ToString without
    // replacing it. It exists only on records and only with this exact
    // signature.
    protected virtual bool PrintMembers(StringBuilder builder)
    {
        builder.Append($"Name = {FullName}");
        return true;
    }

    // An extra constructor MUST chain to the primary one.
    public Employee(string firstName, string lastName)
        : this(firstName, lastName, 0, "unassigned")
    {
    }

    // A positional member's property may be REDECLARED to change its accessor,
    // which suppresses the synthesised one.
    public int Age { get; init; } = Age < 0 ? 0 : Age;
}

// NOMINAL record: no positional list, so nothing is synthesised from a
// parameter list — but Equals, GetHashCode, ToString, the copy constructor and
// `<Clone>$` still are.
public record Settings
{
    public required string Name { get; init; }

    public int Retries { get; init; } = 3;

    public IReadOnlyList<string> Hosts { get; init; } = Array.Empty<string>();
}

// RECORD STRUCT: a value type with value equality synthesised. Mutable by
// default, unlike a record class's init-only positional members.
public record struct Coordinate(double Latitude, double Longitude);

// READONLY RECORD STRUCT: the idiomatic form, with init-only members.
public readonly record struct Temperature(double Celsius)
{
    public double Fahrenheit => (Celsius * 9 / 5) + 32;
}

// Explicit `record class`, which is the same as `record`.
public record class ExplicitClass(int Id);

// Record INHERITANCE. A record may derive only from another record, and the
// synthesised equality walks the whole chain via an EqualityContract property
// that exists in no source.
public abstract record Shape(string Name);

public record Circle(double Radius) : Shape("circle")
{
    public double Area => Math.PI * Radius * Radius;
}

public record Rectangle(double Width, double Height) : Shape("rectangle")
{
    public double Area => Width * Height;
}

public sealed record Square(double Side) : Rectangle(Side, Side);

// A record implementing an interface, with a generic parameter and a
// constraint.
public record Wrapper<T>(T Value) : IComparable<Wrapper<T>>
    where T : IComparable<T>
{
    public int CompareTo(Wrapper<T>? other) => other is null ? 1 : Value.CompareTo(other.Value);
}

// A record with attributes on its POSITIONAL PARAMETERS. Without a target
// specifier the attribute lands on the parameter; `property:` moves it to the
// synthesised property, `field:` to the backing field. Three different targets
// from one syntactic position, and two of the three do not exist in source.
public record Annotated(
    [property: Obsolete("use Identifier")] int Id,
    [param: System.Diagnostics.CodeAnalysis.NotNull] string Name,
    [field: NonSerialized] int Cached);

// A record nested in a class, and a record nesting a record.
public class RecordHost
{
    public record Nested(int Id)
    {
        public record Deeper(int Id, string Extra) : Nested(Id);
    }
}

public class WithExpressions
{
    // `with` calls the synthesised copy constructor and then the `init`
    // accessors of the named members. It is a CALL to a member with no
    // declaration syntax, followed by N property writes.
    public Person Basic(Person original) => original with { Age = 31 };

    public Person Several(Person original) => original with
    {
        FirstName = "Grace",
        LastName = "Hopper",
        Age = 45
    };

    // `with` changing nothing: still a copy-constructor call.
    public Person Identity(Person original) => original with { };

    // `with` on a record STRUCT, which copies by value and needs no copy
    // constructor at all — the same syntax, a different mechanism.
    public Coordinate OnStruct(Coordinate original) => original with { Latitude = 0 };

    public Temperature OnReadOnlyStruct(Temperature original) => original with { Celsius = 100 };

    // `with` on a DERIVED record: the copy constructor is virtual through
    // `<Clone>$`, so the runtime type is preserved.
    public Shape Polymorphic(Shape shape) => shape switch
    {
        Circle c => c with { Radius = c.Radius * 2 },
        Square s => s with { Side = s.Side * 2 },
        Rectangle r => r with { Width = r.Width * 2 },
        _ => shape
    };

    // Chained and nested `with`.
    public Employee Chained(Employee e) =>
        (e with { Age = 30 }) with { Department = "R&D" };

    public Wrapper<int> Nested(Wrapper<int> w) => w with { Value = w.Value + 1 };

    // `with` on an anonymous type — legal since C# 10 and the only non-record
    // use of the keyword.
    public object OnAnonymous()
    {
        var original = new { Id = 1, Name = "n" };
        var modified = original with { Id = 2 };
        return modified;
    }

    // Deconstruction through the SYNTHESISED Deconstruct method.
    public string Deconstructing(Person p)
    {
        var (first, last, age) = p;
        (string f2, string l2, int a2) = p;

        // Positional pattern matching, which also calls Deconstruct.
        string described = p switch
        {
            ("Ada", _, _) => "Ada",
            (_, _, > 100) => "ancient",
            (var f, var l, var a) => $"{f} {l} {a}"
        };

        return first + last + age + f2 + l2 + a2 + described;
    }

    // Value EQUALITY, synthesised. Two distinct instances are equal; the same
    // two as a class would not be.
    public bool Equality()
    {
        var a = new Person("Ada", "Lovelace", 36);
        var b = new Person("Ada", "Lovelace", 36);
        bool equal = a == b;
        bool notSame = !ReferenceEquals(a, b);
        bool viaEquals = a.Equals(b);
        bool viaObject = a.Equals((object)b);
        int sameHash = a.GetHashCode() == b.GetHashCode() ? 1 : 0;

        // Across the inheritance chain: a Square is never equal to a Rectangle
        // with the same members, because EqualityContract differs.
        Rectangle asRectangle = new Rectangle(2, 2);
        Square asSquare = new Square(2);
        bool acrossTypes = asRectangle == asSquare;

        return equal && notSame && viaEquals && viaObject && sameHash == 1 && !acrossTypes;
    }
}
