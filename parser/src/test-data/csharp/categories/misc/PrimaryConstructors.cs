// HALF TWO — PRIMARY CONSTRUCTORS on classes and structs (C# 12).
//
// A record's primary constructor synthesises PROPERTIES. A class's does NOT:
// the parameters become CAPTURED VARIABLES, in scope throughout the whole class
// body, and a backing field is generated only if one is actually captured. So
// the same syntax means two different things on two type kinds, and on a class
// there is no member at all unless the author writes one.
//
// 2,816 primary constructors in the measured corpus (2,782 class + 34 struct).
using System;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.Misc;

// A class primary constructor. `logger` and `retries` are IN SCOPE below and
// are NOT members: `new Service(l, 1).retries` does not compile.
public class Service(IServiceLogger logger, int retries)
{
    // Captured in a field initialiser — the capture happens at construction.
    private readonly List<string> log = new List<string>(retries);

    // Captured in a method body — this is what generates a backing field.
    public void Run(string message)
    {
        for (int attempt = 0; attempt < retries; attempt++)
        {
            logger.Log($"{attempt}: {message}");
            log.Add(message);
        }
    }

    // Captured in a property.
    public int Retries => retries;

    // Captured in an expression-bodied member and in a lambda, which extends
    // the capture into a closure.
    public Func<string> Describe => () => $"{logger.GetType().Name} x{retries}";

    // A SECOND constructor must chain to the primary one — `this(...)` is
    // mandatory, and there is no other way to reach it.
    public Service(IServiceLogger logger)
        : this(logger, 3)
    {
    }

    public IReadOnlyList<string> Log => log;
}

public interface IServiceLogger
{
    void Log(string message);
}

// The DEPENDENCY-INJECTION shape, which is what primary constructors were added
// for: the whole class body is the interesting part and the constructor is
// noise.
public class OrderHandler(IRepository repository, IServiceLogger logger)
{
    public int Handle(int id)
    {
        logger.Log($"handling {id}");
        return repository.Count(id);
    }
}

public interface IRepository
{
    int Count(int id);
}

// A primary constructor with a BASE CALL. The base's arguments are part of the
// heritage clause, not of the constructor — which is why cs_type_heritage
// carries `hasPrimaryConstructorArguments`.
public class Base(int seed)
{
    public int Seed => seed;
}

public class Derived(int seed, string name) : Base(seed)
{
    public string Name => name;
}

// A primary constructor plus an INTERFACE in the same base list, so one entry
// carries arguments and the other cannot.
public class DerivedAndImplements(int seed, string name) : Base(seed), IComparable<DerivedAndImplements>
{
    public string Name => name;

    public int CompareTo(DerivedAndImplements? other) => seed.CompareTo(other?.Seed ?? 0);
}

// BASE ARGUMENTS THAT ARE REAL EXPRESSIONS, not bare parameter reads.
//
// A primary constructor's base argument list is an expression position owned by
// the TYPE — `CsExpressionOwnerKind.TYPE` and `CsRootContext.PRIMARY_CONSTRUCTOR_BASE`
// — and it was the thinnest owner in the corpus at six rows, all of them a
// single identifier. Six rows of one shape cannot discriminate anything, so the
// arguments below are a call, a binary expression, a ternary, a cast, a
// null-coalesce, an interpolation, a `new`, a lambda-bearing call and a nested
// base argument.
public class ComputedBase(int seed, string name)
    : Base(seed * 2 + 1)
{
    public string Name => name;
}

public class CallInBase(int seed) : Base(Normalise(seed))
{
    private static int Normalise(int value) => value < 0 ? 0 : value;
}

public class TernaryInBase(int seed, bool flag) : Base(flag ? seed : -seed)
{
    public bool Flag => flag;
}

public class CastInBase(double seed) : Base((int)seed)
{
}

public class NullCoalesceInBase(int? seed) : Base(seed ?? 0)
{
}

public class NestedCallInBase(int seed) : Base(System.Math.Max(0, System.Math.Min(seed, 100)))
{
}

public class LinqInBase(System.Collections.Generic.IEnumerable<int> values)
    : Base(System.Linq.Enumerable.Sum(values))
{
}

public class InterpolationInBase(int seed) : NamedBase($"seed-{seed}")
{
}

public class NamedBase(string name)
{
    public string Name => name;
}

public class NewInBase(int seed) : Holder(new Payload(seed))
{
}

public class Holder(Payload payload)
{
    public Payload Payload => payload;
}

public sealed class Payload(int value)
{
    public int Value => value;
}

// A RECORD's positional base argument list is the same position with different
// syntax, and it is where this shape actually appears in real code.
public record RecordBase(int Id, string Name);

public record RecordDerived(int Id, string Name, decimal Total)
    : RecordBase(Id, Name.Trim());

public record RecordComputedBase(int Id)
    : RecordBase(Id * 10, $"record-{Id}");

// A primary constructor whose parameter SHADOWS a field of the same name — the
// capture wins inside the body, and `this.name` reaches the field.
public class Shadowing(string name)
{
    private readonly string name = name.ToUpperInvariant();

    // `name` here is the FIELD, because a field initialiser with the same name
    // was declared; outside an initialiser the parameter is shadowed by the
    // member. This is the single most confusing rule in the feature.
    public string FromField => this.name;
}

// A primary constructor with attributes, defaults, params and modifiers on its
// parameters — the full parameter grammar applies.
public class Parameterised(
    [System.Diagnostics.CodeAnalysis.DisallowNull] int required,
    int optional = 1,
    params string[] rest)
{
    public int Total => required + optional + rest.Length;
}

// A GENERIC class with a primary constructor and a constraint.
public class Container<T>(T value) where T : notnull
{
    public T Value => value;

    public bool Matches(T other) => value.Equals(other);
}

// A STRUCT primary constructor. The parameters are captured the same way, and
// the struct still gets its implicit parameterless constructor, which does NOT
// run the primary one.
public struct PointStruct(int x, int y)
{
    public int X => x;

    public int Y => y;

    public int Magnitude => (x * x) + (y * y);
}

// A READONLY struct with a primary constructor.
public readonly struct Money(decimal amount, string currency)
{
    public decimal Amount => amount;

    public string Currency => currency;

    public override string ToString() => $"{amount} {currency}";
}

// A RECORD primary constructor for contrast, in the same file: here the
// parameters DO become public init-only properties, and `r.Id` compiles.
public record RecordWithPrimary(int Id, string Name);

public record struct RecordStructWithPrimary(int Id);

// A primary constructor with ZERO parameters — legal, and different from having
// none at all: it suppresses the implicit parameterless constructor on a class.
public class EmptyPrimary()
{
    public int Value => 1;
}

public class PrimaryConstructorCallSites
{
    public void Differences()
    {
        var service = new Service(new NullLogger(), 2);
        var withDefault = new Service(new NullLogger());

        // On a CLASS, the primary constructor parameter is NOT a member:
        // `service.retries` does not compile. Only the author-written property
        // reaches it.
        int viaProperty = service.Retries;

        // On a RECORD, it IS a member, synthesised.
        var record = new RecordWithPrimary(1, "n");
        int viaSynthesised = record.Id;
        string alsoSynthesised = record.Name;

        // Deconstruction works on the record and not on the class.
        var (id, name) = record;

        // `with` works on the record and not on the class.
        var modified = record with { Id = 2 };

        var derived = new Derived(1, "n");
        var point = new PointStruct(1, 2);
        var defaulted = default(PointStruct);
        var money = new Money(1m, "GBP");
        var container = new Container<string>("v");
        var empty = new EmptyPrimary();

        _ = viaProperty + viaSynthesised + alsoSynthesised.Length + id + name.Length
            + modified.Id + derived.Seed + point.Magnitude + defaulted.X
            + (int)money.Amount + container.Value.Length + empty.Value
            + withDefault.Retries;
    }

    private sealed class NullLogger : IServiceLogger
    {
        public void Log(string message)
        {
        }
    }
}
