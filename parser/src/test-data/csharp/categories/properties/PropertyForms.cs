// HALF TWO — no Java analogue.
//
// A property is neither a field nor a method. It is a DATA LOCATION with up to
// two call targets, and the schema's §2.4 ruling is that it gets its own
// `cs_property` row AND that each accessor is emitted a second time as a
// `cs_method` row owned by the property. Every accessor shape that ruling has
// to cover is below.
//
// The five-minute checklist question that matters here is "does it emit a
// WRAPPER node, or only its parts?" — a parser that emits only get_Name and
// set_Name loses the data location; one that emits only a field loses two call
// targets.
using System;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.Properties;

public class PropertyForms
{
    private int backing;
    private string name = string.Empty;
    private readonly List<int> items = new();

    // AUTO-PROPERTY: two accessors and a compiler-generated backing field that
    // exists in IL and in NO SYNTAX.
    public int Auto { get; set; }

    // Auto-property with an initialiser.
    public int AutoWithInitialiser { get; set; } = 42;

    // Get-only auto-property: assignable only from a constructor.
    public int GetOnlyAuto { get; }

    // EXPRESSION-BODIED property — one accessor, no `get` keyword at all.
    public int ExpressionBodied => backing;

    public string ExpressionBodiedComputed => name.ToUpperInvariant() + backing;

    // Expression-bodied ACCESSORS, which is a different shape from an
    // expression-bodied property: here `get` and `set` are both present.
    public int ExpressionBodiedAccessors
    {
        get => backing;
        set => backing = value;
    }

    // FULL ACCESSOR BODIES, with statements, validation and a throw.
    public string FullBodies
    {
        get
        {
            if (name is null)
            {
                return string.Empty;
            }

            return name;
        }

        set
        {
            if (value is null)
            {
                throw new ArgumentNullException(nameof(value));
            }

            name = value.Trim();
        }
    }

    // SPLIT ACCESSIBILITY: the setter is less accessible than the property.
    // Only one accessor may carry a modifier, and it must be more restrictive.
    public int PrivateSetter { get; private set; }

    public int ProtectedSetter { get; protected set; }

    public int InternalSetter { get; internal set; }

    public int PrivateProtectedSetter { get; private protected set; }

    // The other direction: a private getter on a public property.
    public int PrivateGetter { private get; set; }

    // SET-ONLY: legal, and a write-only data location.
    public int SetOnly
    {
        set => backing = value;
    }

    // `init` — settable during object initialisation only. C# 9. It is a
    // distinct accessor kind, not a `set` with a rule attached.
    public int InitOnly { get; init; }

    public string InitOnlyWithBody
    {
        get => name;
        init => name = value ?? string.Empty;
    }

    // `required` — C# 11. The object initialiser MUST set it, which is a
    // constructor obligation expressed on a member.
    public required int RequiredMember { get; set; }

    public required string RequiredInit { get; init; }

    // STATIC properties, including a static get-only and a static auto.
    public static int StaticAuto { get; set; }

    public static int StaticExpressionBodied => StaticAuto * 2;

    public static int StaticGetOnly { get; } = 7;

    // Accessors carrying ATTRIBUTES, and a property carrying one.
    [Obsolete("use Auto")]
    public int Attributed
    {
        [Obsolete("getter")]
        get => backing;

        [Obsolete("setter")]
        set => backing = value;
    }

    // A property whose accessor bodies contain calls, lambdas and LINQ — the
    // case where a worklist that stops at member boundaries loses everything.
    public IReadOnlyList<int> Filtered
    {
        get
        {
            return items.FindAll(x => Predicate(x));
        }
    }

    private static bool Predicate(int value) => value > 0;

    // A property of a delegate type, of a nullable type, of a tuple type and of
    // a generic type.
    public Func<int, int> DelegateTyped { get; set; } = x => x;

    public int? NullableValue { get; set; }

    public string? NullableReference { get; set; }

    public (int Id, string Name) TupleTyped { get; set; }

    public Dictionary<string, List<int>> GenericTyped { get; } = new();

    // `ref` and `ref readonly` returning properties: the accessor returns an
    // ALIAS. There is no setter and there cannot be one.
    private int[] storage = new int[4];

    public ref int RefProperty => ref storage[0];

    public ref readonly int RefReadonlyProperty => ref storage[1];

    public PropertyForms()
    {
        GetOnlyAuto = 1;
        PrivateSetter = 2;
    }
}

public abstract class PropertyModifiers
{
    // abstract / virtual / override / sealed override / new — a property
    // participates in the whole polymorphism story a method does.
    public abstract int Abstract { get; set; }

    public abstract int AbstractGetOnly { get; }

    public virtual int Virtual { get; set; }

    public virtual int VirtualExpressionBodied => 1;

    public int Hidden { get; set; }
}

public class PropertyOverrides : PropertyModifiers
{
    public override int Abstract { get; set; }

    public override int AbstractGetOnly => 1;

    public override int Virtual
    {
        get => base.Virtual;
        set => base.Virtual = value;
    }

    public sealed override int VirtualExpressionBodied => 2;

    // Overriding a get-only property by ADDING a setter is legal only when the
    // base declares one; `new` hides instead.
    public new int Hidden { get; set; }
}

public interface IWithProperties
{
    // Interface properties: abstract by default, may have a default
    // implementation (C# 8), may be static abstract (C# 11).
    int Required { get; set; }

    int GetOnly { get; }

    int WithDefaultImplementation => 1;

    static abstract int StaticAbstract { get; }

    static int StaticConcrete { get; set; }
}

public class WithProperties : IWithProperties
{
    public int Required { get; set; }

    public int GetOnly => 1;

    public static int StaticAbstract => 2;
}

public class PropertyConsumers
{
    public void ReadsAndWrites(PropertyForms target)
    {
        // A property READ is a call to the getter; a property WRITE is a call
        // to the setter; a compound assignment is BOTH, in that order.
        int read = target.Auto;
        target.Auto = 1;
        target.Auto += 1;
        target.Auto++;
        ++target.Auto;

        // Reading an expression-bodied property.
        int computed = target.ExpressionBodied;

        // Object-initialiser writes, including to `init` and `required`.
        var created = new PropertyForms
        {
            Auto = 1,
            InitOnly = 2,
            RequiredMember = 3,
            RequiredInit = "r",
            NullableReference = null
        };

        // A `with`-free copy through properties.
        var copy = new PropertyForms
        {
            Auto = created.Auto,
            RequiredMember = created.RequiredMember,
            RequiredInit = created.RequiredInit
        };

        // Static property access.
        PropertyForms.StaticAuto = 1;
        int staticRead = PropertyForms.StaticAuto;

        // A ref property used as an alias target.
        ref int alias = ref created.RefProperty;
        alias = 9;

        // Null-conditional read of a property, and a chained property path.
        int? maybe = target?.NullableValue;
        int chained = target.GenericTyped.Count;

        _ = read + computed + copy.Auto + staticRead + (maybe ?? 0) + chained;
    }
}
