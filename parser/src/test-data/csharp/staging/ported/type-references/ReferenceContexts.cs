// Port of java/type-references/{test-type-param-bounds,test-wildcards}.java,
// widened to every syntactic position a type name can appear in.
//
// NO ANALOGUE — Java's use-site wildcards `? extends T`, `? super T` and bare
// `?`. C# has none of the three; the positions where Java would write one are
// covered by a constrained type parameter or by a variant interface, both of
// which appear here, and no wildcard is simulated.
//
// NO ANALOGUE — the THROWS_CLAUSE reference context. C# has no throws clause,
// so that context has no C# position at all and none is invented.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.TypeReferences;

// SELF-CONTAINED BY RULE. `categories/` is canonical for both blessing and
// running, and no fixture reference may cross a project boundary: a type
// reached through a ProjectReference resolves as a METADATA symbol with zero
// DeclaringSyntaxReferences, which is unadjudicable and would read as a parser
// defect that is really an artifact of partitioning. This file used to reach
// into ported/attributes/ for its attribute types; it now declares the one it
// needs as a `file`-local class, which cannot collide and cannot be referenced
// from anywhere else.
[AttributeUsage(AttributeTargets.Method)]
file sealed class TargetedAttribute : Attribute
{
    public TargetedAttribute(string name) => Name = name;

    public string Name { get; }

    // A `Type`-typed named member, so `typeof(...)` in an attribute argument
    // is a type-reference context this file exercises on its own.
    public Type Target { get; set; }
}

public class ReferenceContexts<TOwner>
    where TOwner : EntityBase, IMarker, INamed, IComparable<TOwner>, new()
{
    // Field, readonly field, static field, const field, volatile field.
    private EntityBase field;
    private readonly List<INamed> readonlyField = new List<INamed>();
    private static Dictionary<string, EntityBase> staticField;
    private const string ConstField = "c";
    private volatile int volatileField;

    // Property, indexer, event — each carrying a type reference in a different
    // slot.
    public EntityBase Property { get; set; }

    public IReadOnlyList<INamed> ReadOnlyProperty => readonlyField;

    public EntityBase this[int index] => field;

    public EntityBase this[INamed key] => field;

    public event EventHandler<EventArgs> Event;

    // Parameter positions: plain, optional, params, generic, array, tuple,
    // delegate-typed, nullable, out, ref, in.
    public void Parameters(
        EntityBase plain,
        INamed optional = null,
        params EntityBase[] rest)
    {
    }

    public void MoreParameters(
        List<EntityBase> generic,
        EntityBase[] array,
        (EntityBase Owner, INamed Name) tuple,
        Func<EntityBase, INamed> projection,
        int? nullableValue,
        out EntityBase outParameter,
        ref EntityBase refParameter,
        in EntityBase inParameter)
    {
        outParameter = refParameter;
    }

    // Return-type positions.
    public EntityBase ReturnsReference() => field;

    public List<EntityBase> ReturnsGeneric() => new List<EntityBase>();

    public EntityBase[] ReturnsArray() => new EntityBase[0];

    public (EntityBase Owner, INamed Name) ReturnsTuple() => (field, null);

    public ref EntityBase ReturnsRef() => ref field;

    public IEnumerable<EntityBase> ReturnsIterator()
    {
        yield return field;
    }

    // Type-parameter constraint positions — the direct port of Java's bounds.
    public T Constrained<T>(T value)
        where T : EntityBase, INamed, IComparable<T>, new()
        => value;

    // Base-list position is in HeritageClauses.cs; local declaration position:
    public void LocalDeclarations()
    {
        EntityBase local = field;
        List<INamed> genericLocal = new List<INamed>();
        EntityBase[] arrayLocal = new EntityBase[0];
        var inferredLocal = new List<EntityBase>();
        const int constLocal = 1;
        _ = local?.Describe() + genericLocal.Count + arrayLocal.Length
            + inferredLocal.Count + constLocal;
    }

    // Explicit type arguments on a call and on `new`.
    public void ExplicitTypeArguments()
    {
        _ = Constrained<TOwner>(new TOwner());
        _ = new List<EntityBase>();
        _ = new Dictionary<string, List<EntityBase>>();
        _ = Activator.CreateInstance<TOwner>();
    }

    // Casts, `is`, `as`, `typeof`, `default`, `sizeof`, `nameof`, `catch`,
    // pattern types, and the attribute-argument `typeof`.
    [Targeted("n", Target = typeof(EntityBase))]
    public void TypeOnlyPositions(object value)
    {
        _ = (EntityBase)value;
        _ = value is EntityBase;
        _ = value is List<INamed>;
        _ = value as EntityBase;
        _ = typeof(EntityBase);
        _ = typeof(List<>);
        _ = typeof(Dictionary<,>);
        _ = default(EntityBase);
        _ = sizeof(int);
        _ = nameof(EntityBase);

        if (value is EntityBase { } declared)
        {
            _ = declared;
        }

        switch (value)
        {
            case List<INamed> list:
                _ = list.Count;
                break;
        }

        try
        {
            throw new InvalidOperationException();
        }
        catch (InvalidOperationException e) when (e is Exception)
        {
        }
    }

    // The C# stand-ins for Java's wildcards. Neither is a wildcard.
    public void CovariantInsteadOfExtends(IEnumerable<EntityBase> anySubtype)
    {
    }

    public void ContravariantInsteadOfSuper(IComparer<EntityBase> anySupertype)
    {
    }

    public void ConstrainedInsteadOfBoundedWildcard<T>(List<T> values)
        where T : EntityBase
    {
    }

    // Java's bare `?` (unknown type argument) has no C# form; the nearest is a
    // non-generic base interface, which is what the BCL itself does.
    public void NonGenericBaseInsteadOfUnbounded(System.Collections.IEnumerable anything)
    {
    }
}
