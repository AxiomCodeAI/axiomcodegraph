// Port of java/type-registry/test-type-categories.java.
// Every value the schema's `typeCategory` can take, one declaration each, plus
// the three C# categories Java has no member of: STRUCT, RECORD_STRUCT and
// DELEGATE. Java's @interface (annotation declaration) has no C# category —
// an attribute is an ordinary CLASS deriving from Attribute, which is why
// ../attributes/ declares them as classes and no new category is invented.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.TypeRegistry;

// CLASS
public class PlainClass
{
}

// CLASS, abstract
public abstract class AbstractClass
{
    public abstract void Required();
}

// CLASS, sealed
public sealed class SealedClass
{
}

// CLASS, static — cannot be instantiated, cannot be a type, all members static.
public static class StaticClass
{
    public static int Value => 1;
}

// CLASS, partial. The other parts and the identity rules are in
// ../../csharp-only/partial/.
public partial class PartialClass
{
    public int First;
}

public partial class PartialClass
{
    public int Second;
}

// INTERFACE
public interface IPlainInterface
{
    void Required();
}

// INTERFACE, generic and variant
public interface IVariant<in TIn, out TOut>
{
    TOut Convert(TIn input);
}

// STRUCT
public struct PlainStruct
{
    public int Value;
}

// STRUCT, readonly — every instance member is implicitly readonly.
public readonly struct ReadOnlyStruct
{
    public ReadOnlyStruct(int value) => Value = value;

    public int Value { get; }
}

// STRUCT, ref — stack-only, cannot be boxed, cannot be a field of a class,
// cannot be a type argument. No Java analogue and a real engine constraint.
public ref struct RefStruct
{
    public Span<byte> Buffer;
}

// STRUCT, readonly ref
public readonly ref struct ReadOnlyRefStruct
{
    public ReadOnlyRefStruct(ReadOnlySpan<char> text) => Text = text;

    public ReadOnlySpan<char> Text { get; }
}

// RECORD (a class)
public record PlainRecord(int Id, string Name);

// RECORD with a body
public record RecordWithBody(int Id)
{
    public string Computed => Id.ToString();
}

// RECORD, explicitly a class
public record class ExplicitRecordClass(int Id);

// RECORD_STRUCT
public record struct PlainRecordStruct(int Id, string Name);

// RECORD_STRUCT, readonly
public readonly record struct ReadOnlyRecordStruct(int Id);

// ENUM
public enum PlainEnum
{
    A,
    B
}

// DELEGATE — a named TYPE whose values are method references. Java has no type
// category for this at all; its functional interfaces are interfaces.
public delegate void PlainDelegate();

public delegate int GenericDelegate<T>(T input);

public delegate TOut VariantDelegate<in TIn, out TOut>(TIn input);

// A generic type at three arities, which are three distinct entries.
public class Arity
{
}

public class Arity<T>
{
}

public class Arity<T1, T2>
{
}

// `file`-local types (C# 11): visible only within THIS FILE, even to other
// parts of the same namespace. Two files may declare `file class Helper` and
// they are different types. No Java analogue; source generators depend on it.
file class FileLocalHelper
{
    public int Value => 1;
}

file interface IFileLocal
{
}

public class UsesFileLocal
{
    // A file-local type may not appear in the SIGNATURE of a non-file-local
    // member (CS9051), so it is confined to a local variable here. That
    // restriction is itself the shape source generators rely on.
    public int Value()
    {
        var helper = new FileLocalHelper();
        return helper.Value;
    }
}
