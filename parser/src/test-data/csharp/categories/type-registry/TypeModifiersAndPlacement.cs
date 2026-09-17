// Port of java/type-registry/{test-type-access,test-type-modifiers,
// test-type-placement,NestedTypePatterns,AnonymousLocalPatterns}.java.
//
// NO ANALOGUE — INNER (non-static) CLASSES. Every C# nested type is what Java
// calls a static nested class: it has no implicit reference to an enclosing
// instance, and `Outer.Inner` cannot be written `outer.new Inner()`. Java's
// inner classes do not port and nothing here simulates one.
//
// NO ANALOGUE — LOCAL CLASSES. C# cannot declare a class inside a method body
// at all. Java's local classes and anonymous classes do not port; the real C#
// replacements are a local function (covered in ../../csharp-only/functions/),
// a lambda, and an anonymous TYPE, which declares data only.
//
// NO ANALOGUE — Java's package-private default. A C# top-level type with no
// modifier is `internal` (assembly-wide), and a nested type with no modifier is
// `private`. Two different defaults from one absence.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.TypeRegistry;

// Accessibility at top level: only `public`, `internal` and `file` are legal.
public class PublicTopLevel
{
}

internal class InternalTopLevel
{
}

class DefaultTopLevelIsInternal
{
}

public class NestingHost
{
    // Accessibility of a NESTED type: all six levels are legal.
    public class PublicNested
    {
    }

    internal class InternalNested
    {
    }

    protected class ProtectedNested
    {
    }

    private class PrivateNested
    {
    }

    protected internal class ProtectedInternalNested
    {
    }

    private protected class PrivateProtectedNested
    {
    }

    class DefaultNestedIsPrivate
    {
    }

    // Every category can nest, including inside a struct, an interface and a
    // record.
    public struct NestedStruct
    {
    }

    public interface INestedInterface
    {
    }

    public enum NestedEnum
    {
        A
    }

    public record NestedRecord(int Id);

    public delegate void NestedDelegate();

    // Three levels of nesting.
    public class Middle
    {
        public class Innermost
        {
            public int Value;
        }
    }

    // A nested type that is generic, inside a non-generic outer.
    public class GenericNested<T>
    {
        public T Value;
    }

    // A nested type with the same NAME as a top-level one — different types.
    public class PublicTopLevel
    {
    }
}

public struct StructWithNestedTypes
{
    public class NestedInStruct
    {
    }

    public enum Kind
    {
        A
    }
}

public interface IWithNestedTypes
{
    // A nested type in an interface: legal in C#, and it is implicitly public.
    public class NestedInInterface
    {
    }

    enum Kind
    {
        A
    }
}

public record RecordWithNestedTypes(int Id)
{
    public class NestedInRecord
    {
    }
}

public class GenericOuter<TOuter>
{
    // A generic type nested inside a generic type; the outer parameter is in
    // scope in the inner.
    public class GenericInner<TInner>
    {
        public TOuter Outer;
        public TInner Inner;
    }

    // A non-generic nested type still closes over TOuter, so its full name has
    // an arity of one from the outside.
    public class NonGenericInner
    {
        public TOuter Outer;
    }
}

public class ModifierMatrix
{
    // Static, abstract, sealed, partial, readonly, ref — as they combine.
    public abstract class AbstractNested
    {
    }

    public sealed class SealedNested
    {
    }

    public static class StaticNested
    {
    }

    public abstract partial class AbstractPartialNested
    {
    }

    public partial class AbstractPartialNested
    {
        public int Added;
    }

    public readonly struct ReadOnlyNestedStruct
    {
    }

    public sealed record SealedNestedRecord(int Id);

    public abstract record AbstractNestedRecord(int Id);
}

// `new` on a NESTED TYPE — hides an inherited nested type of the same name.
// Two distinct types with one short name, and the base one is still reachable
// as `NestedTypeHidingBase.Inner`. Closes CsTypeModifier.NEW, which was
// declared and unreached: the corpus had `new` on methods, fields and events
// and never on a type.
public class NestedTypeHidingBase
{
    public class Inner
    {
        public int Value => 1;
    }

    public struct InnerStruct
    {
        public int Value;
    }

    public enum InnerEnum
    {
        A,
    }
}

public class NestedTypeHidingDerived : NestedTypeHidingBase
{
    public new class Inner
    {
        public int Value => 2;
    }

    public new struct InnerStruct
    {
        public string Value;
    }

    protected new enum InnerEnum
    {
        B,
    }

    public int Both()
    {
        Inner derived = new Inner();
        NestedTypeHidingBase.Inner baseOne = new NestedTypeHidingBase.Inner();
        return derived.Value + baseOne.Value;
    }
}

public class PlacementExamples
{
    // A type held on a static field, which is the nearest thing to a Java
    // local class that C# actually has.
    public static readonly Type NestedTypeHandle = typeof(NestingHost.Middle.Innermost);

    public void AnonymousTypes()
    {
        // An anonymous type: a compiler-generated sealed class with read-only
        // properties, no name in the source, no base type but object, and no
        // interfaces. It is NOT Java's anonymous class.
        var single = new { Name = "n" };
        var multiple = new { Id = 1, Name = "n", Total = 1.5m };
        var projected = new { multiple.Id, multiple.Name };
        var nested = new { Inner = new { Deep = 1 } };
        var inCollection = new[]
        {
            new { Id = 1 },
            new { Id = 2 }
        };

        _ = single.Name.Length + multiple.Id + projected.Id + nested.Inner.Deep + inCollection.Length;
    }

    public void LocalFunctionsInsteadOfLocalClasses()
    {
        // The C# replacement for a Java local class: a local FUNCTION, which
        // has no type of its own.
        int Local(int x) => x + 1;

        static int StaticLocal(int x) => x + 2;

        _ = Local(1) + StaticLocal(1);
    }

    public IComparer<int> LambdaInsteadOfAnonymousClass()
    {
        // The C# replacement for Java's `new Comparator<Integer>() { ... }`.
        return Comparer<int>.Create((a, b) => a.CompareTo(b));
    }
}
