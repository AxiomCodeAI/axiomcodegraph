// Port of java/type-references/{test-superclass-refs,test-interface-refs,
// test-permits-refs}.java — and the fixture for the schema's §3.3 ruling that
// `heritageKind` is BASE_OR_INTERFACE because C# syntax cannot tell them apart.
//
// The ruling is tested here from both sides:
//
//   * GENUINELY AMBIGUOUS. In `class C : A, IB`, position 0 is a base class or
//     an interface and only resolution says which. `ClassBaseOnly`,
//     `ClassInterfaceOnly` and `ClassBaseAndInterfaces` below are
//     byte-indistinguishable in that respect.
//   * DECIDED BY THE LANGUAGE. A `struct`, a `record struct`, an `interface`
//     and an `enum` can have NO base class, so every entry in their base list
//     is an interface by rule, with no resolution at all.
//
// NO ANALOGUE — Java's `sealed ... permits` list. C# `sealed` forbids
// derivation outright and has no permits clause; the closest real C# shape is a
// non-`sealed` abstract base with `private protected` constructors, which is
// shown at the bottom.
using System;
using System.Collections;
using System.Collections.Generic;

namespace Fixtures.Ported.TypeReferences;

public interface IMarker
{
}

public interface INamed
{
    string Name { get; }
}

public interface IIdentified<TKey>
{
    TKey Id { get; }
}

public interface IComposite : IMarker, INamed
{
}

public abstract class EntityBase
{
    protected EntityBase()
    {
    }

    public abstract string Describe();
}

public abstract class EntityBase<TKey> : EntityBase, IIdentified<TKey>
{
    public TKey Id { get; set; }

    public override string Describe() => Id?.ToString() ?? string.Empty;
}

// --- The ambiguous shapes -------------------------------------------------

// One entry, and it is a BASE CLASS.
public class ClassBaseOnly : EntityBase
{
    public override string Describe() => "base only";
}

// One entry, and it is an INTERFACE. Syntactically identical to the above.
public class ClassInterfaceOnly : IMarker
{
}

// Several entries. C# REQUIRES the base class first if one is present, so
// position 0 is the only ambiguous slot and positions 1..n are interfaces by
// the grammar. That is a fact a parser can act on and the schema currently
// does not; recorded in the manifest as a finding for cs-oracle rather than
// assumed here.
public class ClassBaseAndInterfaces : EntityBase, IMarker, INamed
{
    public string Name => "named";

    public override string Describe() => Name;
}

// Several entries, ALL interfaces, no base class — position 0 is an interface.
public class ClassInterfacesOnly : IMarker, INamed, IComparable<ClassInterfacesOnly>
{
    public string Name => "n";

    public int CompareTo(ClassInterfacesOnly other) => 0;
}

// Generic base with a concrete argument, and with a forwarded one.
public class ClassGenericBase : EntityBase<int>
{
}

public class ClassForwardsTypeArgument<TKey> : EntityBase<TKey>, IIdentified<TKey>
{
}

// Nested generic argument in the base list.
public class ClassNestedGenericBase : EntityBase<Dictionary<string, List<int>>>
{
}

// Base list entry that is a NESTED type.
public class Container
{
    public class NestedBase
    {
    }

    public interface INested
    {
    }
}

public class ClassNestedBase : Container.NestedBase, Container.INested
{
}

// Base list entry reached through an alias and through `global::`.
public class ClassQualifiedBase : global::Fixtures.Ported.TypeReferences.EntityBase
{
    public override string Describe() => string.Empty;
}

// --- The shapes the LANGUAGE decides --------------------------------------

// A struct can have NO base class. Every entry is an interface, by rule.
public struct StructImplements : IMarker, INamed, IEquatable<StructImplements>
{
    public string Name => "s";

    public bool Equals(StructImplements other) => true;

    public override bool Equals(object obj) => obj is StructImplements other && Equals(other);

    public override int GetHashCode() => 0;
}

public readonly struct ReadOnlyStructImplements : IMarker
{
}

public ref struct RefStructImplements
{
    // A `ref struct` could not implement an interface at all before C# 13's
    // `allows ref struct`; it may declare one only when the interface is
    // implemented without boxing. Left with no base list deliberately.
    public int Value;
}

// A record STRUCT: no base class either, so all interfaces by rule.
public record struct RecordStructImplements(int Id) : IMarker, IIdentified<int>
{
    readonly int IIdentified<int>.Id => Id;
}

// A record CLASS may have a base record, so it is ambiguous like a class.
public record RecordBase(string Name);

public record RecordDerived(string Name, int Id) : RecordBase(Name), IMarker;

public record RecordInterfaceOnly(int Id) : IMarker;

// An interface base list is ALL interfaces, by rule.
public interface IDerivedInterface : IMarker, INamed, IEnumerable<int>
{
}

public interface IGenericDerived<T> : IIdentified<T>, IComparable<IGenericDerived<T>>
{
}

// An enum's "base list" is not a base list at all — it is the UNDERLYING TYPE,
// which shares the `: T` syntax and means something completely different. Any
// parser treating `: byte` as a heritage entry is wrong.
public enum EnumWithUnderlyingType : byte
{
    A = 1
}

// A delegate has no base list; its `:`-free signature is shown for contrast.
public delegate int NoBaseList(int value);

// --- Depth, overrides and the sealed/permits gap --------------------------

public class Level1 : EntityBase
{
    public override string Describe() => "1";
}

public class Level2 : Level1
{
    public override string Describe() => "2";
}

public sealed class Level3 : Level2
{
    public override string Describe() => "3";
}

// `sealed` closes the hierarchy globally. There is no `permits` list, so the
// nearest C# expression of "these types and no others" is an abstract base
// whose only constructor is private protected.
public abstract class ClosedHierarchy
{
    private protected ClosedHierarchy()
    {
    }

    public sealed class OnlyA : ClosedHierarchy
    {
    }

    public sealed class OnlyB : ClosedHierarchy
    {
    }
}

// A type implementing the same generic interface at TWO different arities and
// TWO different type arguments — legal in C#, illegal in Java.
public class TwoInstantiations : IIdentified<int>, IIdentified<string>
{
    int IIdentified<int>.Id => 1;

    string IIdentified<string>.Id => "1";
}

// Base list plus type-parameter constraints — two reference contexts in one
// declaration header.
public class ConstrainedAndDerived<T> : EntityBase<T>, IMarker
    where T : IComparable<T>, new()
{
}

// An implicit base: every class without a base list derives from object, and
// every struct from ValueType. That edge exists in the semantics and in NO
// syntax, which is the mirror image of an implicit `using`.
public class ImplicitObjectBase
{
}
