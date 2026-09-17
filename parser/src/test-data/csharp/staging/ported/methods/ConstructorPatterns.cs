// Port of java/methods/ConstructorPatterns.java.
// Primary constructors (C# 12) are a separate construct with their own fixture
// at ../../csharp-only/misc/PrimaryConstructors.cs.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.Methods;

public class ConstructorPatterns
{
    private readonly int seed;
    private readonly string name;
    private readonly List<int> items;

    // Parameterless.
    public ConstructorPatterns()
    {
        seed = 0;
        name = string.Empty;
        items = new List<int>();
    }

    // `this(...)` chaining — Java's this(...).
    public ConstructorPatterns(int seed)
        : this(seed, "unnamed")
    {
    }

    // The designated constructor.
    public ConstructorPatterns(int seed, string name)
    {
        this.seed = seed;
        this.name = name;
        this.items = new List<int>();
    }

    // Optional parameters make a family of constructors from one declaration —
    // no Java form, and it interacts with overload resolution.
    public ConstructorPatterns(int seed, string name, bool prefill = false, int capacity = 4)
        : this(seed, name)
    {
        items = new List<int>(capacity);
        if (prefill)
        {
            items.Add(seed);
        }
    }

    // A copy constructor. C# records synthesise one; a class must write it.
    public ConstructorPatterns(ConstructorPatterns other)
        : this(other.seed, other.name)
    {
        items = new List<int>(other.items);
    }

    // Expression-bodied constructor.
    public ConstructorPatterns(string name) => this.name = name;

    // A static constructor: no accessibility, no parameters, runs once, cannot
    // be called. Java's static initialiser block is the analogue but is not a
    // member.
    static ConstructorPatterns()
    {
        Registry = new Dictionary<int, ConstructorPatterns>();
    }

    public static Dictionary<int, ConstructorPatterns> Registry { get; }

    public int Seed => seed;

    public string Name => name;

    public IReadOnlyList<int> Items => items;
}

public class BaseWithConstructors
{
    protected BaseWithConstructors()
    {
    }

    protected BaseWithConstructors(int seed)
    {
        Seed = seed;
    }

    public int Seed { get; }
}

public class DerivedWithConstructors : BaseWithConstructors
{
    // `base(...)` chaining — Java's super(...).
    public DerivedWithConstructors()
        : base(0)
    {
    }

    public DerivedWithConstructors(int seed)
        : base(seed)
    {
    }

    // Chaining to a sibling that itself chains to the base.
    public DerivedWithConstructors(string raw)
        : this(int.Parse(raw))
    {
    }
}

// A derived class with NO constructor at all: C# does NOT inherit constructors,
// so this type has only an implicit parameterless one, and it only compiles
// because the base has an accessible parameterless constructor.
public class DerivedWithImplicitConstructor : BaseWithConstructors
{
}

public sealed class Singleton
{
    private static readonly Lazy<Singleton> Instance = new Lazy<Singleton>(() => new Singleton());

    // A private constructor closing the type to outside construction.
    private Singleton()
    {
    }

    public static Singleton Current => Instance.Value;
}

public class FactoryOnly
{
    protected FactoryOnly(int seed) => Seed = seed;

    public int Seed { get; }

    public static FactoryOnly Create(int seed) => new FactoryOnly(seed);

    // A generic static factory — the C# and TypeScript answer to Java's
    // generic constructor, which neither language has.
    public static TResult CreateAs<TResult>() where TResult : FactoryOnly, new() => new TResult();
}

public class GenericConstructed<T>
{
    public GenericConstructed()
    {
    }

    public GenericConstructed(T value) => Value = value;

    // NO ANALOGUE — a C# constructor cannot declare its own type parameters.
    // Java's `<U> Ctor(U u)` has no port; the static factory above is the
    // replacement real code uses.
    public T Value { get; }
}

public class ObjectInitialiserTarget
{
    // A parameterless constructor plus settable properties is the shape object
    // initialisers require.
    public int Id { get; set; }

    public string Name { get; set; }

    public List<int> Tags { get; } = new List<int>();

    public static ObjectInitialiserTarget Build() => new ObjectInitialiserTarget
    {
        Id = 1,
        Name = "n",
        Tags = { 1, 2, 3 }
    };
}
