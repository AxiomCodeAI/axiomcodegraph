// HALF TWO — EXPLICIT INTERFACE IMPLEMENTATION: a member with no accessible
// name on the type.
//
// `void IFoo.Bar() { }` has NO accessibility modifier (it is neither public nor
// private — it has none), cannot be called through the declaring type, cannot
// be `virtual`, `override`, `abstract` or `static`, and is invisible to any
// extractor that keys members by name alone. 4,733 sites in the measured
// corpus.
//
// The schema carries `explicitInterfaceName` AS WRITTEN and does not resolve
// it, which matters because the interface may be a constructed generic, may be
// reached through an alias, and may be named differently in two files.
using System;
using System.Collections;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.ExplicitInterface;

public interface IReader
{
    string Read();

    int Position { get; }

    event EventHandler Advanced;

    string this[int index] { get; }
}

public interface IWriter
{
    // THE SAME MEMBER NAMES as IReader, deliberately.
    string Read();

    int Position { get; set; }

    event EventHandler Advanced;

    string this[int index] { get; set; }

    void Write(string value);
}

public interface IDisposableReader : IReader, IDisposable
{
}

// A type implementing TWO INTERFACES THAT DECLARE THE SAME MEMBER NAME. Without
// explicit implementation there is exactly one `Read()` satisfying both; with
// it there are two, and neither is reachable through the type.
public class Duplex : IReader, IWriter
{
    private int position;
    private readonly List<string> buffer = new();

    // EXPLICIT: belongs to IReader only.
    string IReader.Read() => "read";

    // EXPLICIT: belongs to IWriter only. Same name, same signature, different
    // member.
    string IWriter.Read() => "write-read";

    int IReader.Position => position;

    int IWriter.Position
    {
        get => position;
        set => position = value;
    }

    private EventHandler? readerAdvanced;
    private EventHandler? writerAdvanced;

    event EventHandler IReader.Advanced
    {
        add => readerAdvanced += value;
        remove => readerAdvanced -= value;
    }

    event EventHandler IWriter.Advanced
    {
        add => writerAdvanced += value;
        remove => writerAdvanced -= value;
    }

    string IReader.this[int index] => buffer[index];

    string IWriter.this[int index]
    {
        get => buffer[index];
        set => buffer[index] = value;
    }

    // IMPLICIT: `Write` is declared by IWriter only, so the ordinary public
    // member satisfies it and IS reachable through the type.
    public void Write(string value)
    {
        buffer.Add(value);
        position++;
        readerAdvanced?.Invoke(this, EventArgs.Empty);
        writerAdvanced?.Invoke(this, EventArgs.Empty);
    }

    // A PUBLIC member with the same name as the explicit ones. Three members
    // called `Read` on one type, two of them nameless from outside.
    public string Read() => "public";
}

// The mixed shape the BCL uses everywhere: a public member for callers, plus an
// explicit one that adapts it to a legacy or non-generic interface.
public class Collection<T> : IEnumerable<T>, ICollection, IReadOnlyList<T>
{
    private readonly List<T> items = new();

    public int Count => items.Count;

    public T this[int index] => items[index];

    public IEnumerator<T> GetEnumerator() => items.GetEnumerator();

    // EXPLICIT: the non-generic overload, which would otherwise collide with
    // the generic one by return type alone — something C# does not permit for
    // ordinary members.
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    // EXPLICIT: members nobody should see, hidden from IntelliSense and from
    // the type's public surface.
    bool ICollection.IsSynchronized => false;

    object ICollection.SyncRoot => this;

    void ICollection.CopyTo(Array array, int index) => ((ICollection)items).CopyTo(array, index);
}

// Explicit implementation of a CONSTRUCTED GENERIC interface, and of the same
// generic interface at two different type arguments — legal in C#, illegal in
// Java, and impossible without explicit implementation.
public class TwoInstantiations : IComparable<int>, IComparable<string>, IEquatable<int>
{
    int IComparable<int>.CompareTo(int other) => 0;

    int IComparable<string>.CompareTo(string? other) => 0;

    bool IEquatable<int>.Equals(int other) => true;
}

// Explicit implementation in a STRUCT: calling it BOXES the struct, which is a
// real allocation the syntax does not show.
public struct ExplicitStruct : IComparable<ExplicitStruct>, IReader
{
    public int Value;

    int IComparable<ExplicitStruct>.CompareTo(ExplicitStruct other) => Value.CompareTo(other.Value);

    string IReader.Read() => Value.ToString();

    int IReader.Position => 0;

    event EventHandler IReader.Advanced
    {
        add { }
        remove { }
    }

    string IReader.this[int index] => index.ToString();
}

// Explicit implementation in a RECORD.
public record ExplicitRecord(int Id) : IComparable<ExplicitRecord>
{
    int IComparable<ExplicitRecord>.CompareTo(ExplicitRecord? other) => Id.CompareTo(other?.Id ?? 0);
}

// An ABSTRACT class implementing an interface explicitly, forwarding to an
// abstract member — the template-method shape.
public abstract class ReaderBase : IReader
{
    string IReader.Read() => ReadCore();

    int IReader.Position => PositionCore;

    event EventHandler IReader.Advanced
    {
        add { }
        remove { }
    }

    string IReader.this[int index] => ReadCore();

    protected abstract string ReadCore();

    protected abstract int PositionCore { get; }
}

public sealed class ConcreteReader : ReaderBase
{
    protected override string ReadCore() => "concrete";

    protected override int PositionCore => 1;
}

public class CallSites
{
    // The ONLY way to reach an explicit member is through an interface-typed
    // reference. Every line below either casts or declares an interface local.
    public string ThroughInterfaceTypedLocal()
    {
        var duplex = new Duplex();

        // The public member, reachable by name.
        string viaType = duplex.Read();

        // The explicit members, reachable only through the interfaces.
        IReader asReader = duplex;
        IWriter asWriter = duplex;
        string viaReader = asReader.Read();
        string viaWriter = asWriter.Read();

        // Through an inline cast.
        string viaCast = ((IReader)duplex).Read();
        string viaOtherCast = ((IWriter)duplex).Read();

        // Properties, events and indexers through the interface.
        int readerPosition = asReader.Position;
        asWriter.Position = 1;
        asReader.Advanced += OnAdvanced;
        asWriter.Advanced += OnAdvanced;
        duplex.Write("x");
        string viaReaderIndexer = asReader[0];
        asWriter[0] = "y";

        // Through a generic constraint, which is how library code reaches them
        // without a cast.
        string viaConstraint = ReadFrom(duplex);

        return viaType + viaReader + viaWriter + viaCast + viaOtherCast
            + readerPosition + viaReaderIndexer + viaConstraint;
    }

    private static string ReadFrom<T>(T source) where T : IReader => source.Read();

    private void OnAdvanced(object? sender, EventArgs args)
    {
    }

    // Calling an explicit member on a STRUCT through its interface BOXES it,
    // and the boxed copy is what the member mutates.
    public int Boxing()
    {
        var value = new ExplicitStruct { Value = 1 };
        IReader boxed = value;
        string read = boxed.Read();

        // Through a constrained generic, which does NOT box.
        string unboxed = ReadFrom(value);

        return read.Length + unboxed.Length;
    }

    // The non-generic enumerator, reachable only as an explicit member.
    public int Enumerating(Collection<int> collection)
    {
        int count = 0;
        foreach (int item in collection)
        {
            count += item;
        }

        IEnumerable nonGeneric = collection;
        foreach (object? item in nonGeneric)
        {
            count += item is int i ? i : 0;
        }

        IEnumerator explicitEnumerator = ((IEnumerable)collection).GetEnumerator();
        while (explicitEnumerator.MoveNext())
        {
            count++;
        }

        return count;
    }
}
