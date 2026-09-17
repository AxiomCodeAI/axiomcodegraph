// ONE FILE. TWO PUBLIC APIs.
//
// Under net8.0 this type has: Parse(ReadOnlySpan<char>), a DateOnly property,
// an IAsyncEnumerable method, a default interface implementation and a record.
// Under netstandard2.0 it has: Parse(string), a DateTime property, an
// IEnumerable method, an abstract interface member and a class.
//
// NOTHING in the source picks one. Nothing in the source can.
using System;
using System.Collections.Generic;

#if MODERN
using System.Threading.Tasks;
#endif

namespace Fixtures.MultiTarget;

// #if guarding a WHOLE TYPE DECLARATION. Under one framework this type exists;
// under the other it does not.
#if MODERN
public sealed record Snapshot(int Id, DateOnly TakenOn);
#else
public sealed class Snapshot
{
    public Snapshot(int id, DateTime takenOn)
    {
        Id = id;
        TakenOn = takenOn;
    }

    public int Id { get; }

    public DateTime TakenOn { get; }
}
#endif

// #if guarding the BASE LIST of a type — the FRAGMENT class from the corpus
// measurement, where the guarded region is not independently parseable because
// it is half of a syntactic construct. 16.9% of measured regions look like
// this, and 54.8% of one multi-targeting library's (corpus stratum multitarget-A).
public partial class Client
#if MODERN
    : IAsyncDisposable, IDisposable
#else
    : IDisposable
#endif
{
    private bool disposed;

    public void Dispose() => disposed = true;

#if MODERN
    public ValueTask DisposeAsync()
    {
        disposed = true;
        return default;
    }
#endif

    public bool Disposed => disposed;
}

public partial class Client
{
    // #if guarding a METHOD DECLARATION — two overloads that never coexist.
#if MODERN
    public static int Parse(ReadOnlySpan<char> text) => int.Parse(text);

    public static bool TryParse(ReadOnlySpan<char> text, out int value) =>
        int.TryParse(text, out value);
#else
    public static int Parse(string text) => int.Parse(text);

    public static bool TryParse(string text, out int value) =>
        int.TryParse(text, out value);
#endif

    // #if guarding a FIELD and a PROPERTY of different types under the same
    // name — so the member exists in both, with a different type reference.
#if MODERN
    private DateOnly takenOn;

    public DateOnly TakenOn
    {
        get => takenOn;
        set => takenOn = value;
    }
#else
    private DateTime takenOn;

    public DateTime TakenOn
    {
        get => takenOn;
        set => takenOn = value;
    }
#endif

    // #if guarding a return TYPE only — a fragment inside a signature.
    public
#if MODERN
        IReadOnlyList<int>
#else
        IList<int>
#endif
        Items() => new List<int>();

    // #if guarding STATEMENTS inside a body, which is the 25.2% case and the
    // one every language has.
    public string Describe()
    {
        string result;
#if MODERN
        result = $"modern {TakenOn:O}";
#else
        result = "legacy " + TakenOn.ToString("O");
#endif
        return result;
    }

    // Nested conditionals, #elif and #else, and a negated condition.
#if MODERN
#if NET8_0_OR_GREATER
    public const string Flavour = "net8+";
#else
    public const string Flavour = "modern-but-not-net8";
#endif
#elif LEGACY
    public const string Flavour = "netstandard";
#else
    public const string Flavour = "unknown";
#endif

#if !LEGACY
    public const bool HasSpans = true;
#else
    public const bool HasSpans = false;
#endif

    // A condition on a symbol defined in NEITHER configuration: the guarded
    // declaration exists in no compilation at all, and tree-sitter still parses
    // it. This is the row that must never be emitted as live.
#if NEVER_DEFINED
    public void DeadDeclaration()
    {
        UndefinedType x = new UndefinedType();
    }
#endif

    // The inverse: a symbol defined in BOTH, so both branches of #if/#else
    // resolve the same way and the #else is dead in every configuration.
#if NETCOREAPP || NETSTANDARD
    public const string AlwaysTrue = "yes";
#else
    public const string AlwaysTrue = "no";
#endif
}

// #if guarding ENUM MEMBERS — the 1.1% case, and the one where a member's
// numeric value silently shifts between configurations.
public enum Capability
{
    None = 0,
    Basic = 1,
#if MODERN
    Spans = 2,
    AsyncStreams = 3,
#endif
    All = 99
}

// #if guarding an INTERFACE MEMBER, including a default implementation that
// only one framework's language level allows.
public interface IStore
{
    int Count { get; }

#if MODERN
    // A default interface implementation: C# 8 and a runtime feature, so it is
    // legal on net8.0 and NOT on netstandard2.0.
    int CountOrZero => Count;

    IAsyncEnumerable<int> StreamAsync();
#else
    IEnumerable<int> Stream();
#endif
}

// #region / #endregion, which are not conditional at all but share the
// preprocessor and are the most common directive in real C#.
public class Regions
{
    #region Fields

    private int first;
    private int second;

    #endregion

    #region Methods

    public int Sum() => first + second;

    #endregion
}

// #warning, #error (commented, since it would fail the build), #line, #pragma.
public class OtherDirectives
{
#pragma warning disable CS0169
    private int deliberatelyUnused;
#pragma warning restore CS0169

#if NEVER_DEFINED
#error this is never reached
#endif

    public int Value => 1;
}
