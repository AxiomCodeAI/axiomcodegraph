// HALF TWO — the source-generator partial shape, with REAL generators.
//
// Every `partial` in this file has ONE part in source. The other part is
// written by a generator that ships in the .NET SDK, at build time, into a
// file that is not on disk. That is the 76.5% case, and it is why:
//
//   * a gate asserting "every partial group has >= 2 parts" FAILS ON CORRECT
//     OUTPUT (schema §2.1, consequence 2);
//   * Roslyn's ISymbol.DeclaringSyntaxReferences returns 2 where the parser can
//     only ever see 1, so the oracle's set-equality check must exclude
//     generated parts or it reports a defect that is not one;
//   * the method bodies below CALL members that exist in no file the parser
//     will ever read.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Fixtures.PartialGenerated;

// ONE part on disk. The regex source generator writes the other, containing the
// BODY of SlugPattern and a nested generated class.
public partial class Patterns
{
    [GeneratedRegex(@"^[a-z0-9]+(?:-[a-z0-9]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex SlugPattern();

    [GeneratedRegex(@"\s+")]
    public static partial Regex Whitespace();

    [GeneratedRegex(@"(?<year>\d{4})-(?<month>\d{2})", RegexOptions.ExplicitCapture, 200)]
    internal static partial Regex DatePattern();

    // A call to a method whose only declaration in source is a signature.
    public static bool IsSlug(string candidate) => SlugPattern().IsMatch(candidate);

    public static string Collapse(string text) => Whitespace().Replace(text, " ");

    public static string? Year(string text)
    {
        Match match = DatePattern().Match(text);
        return match.Success ? match.Groups["year"].Value : null;
    }
}

// ONE part on disk. LibraryImportGenerator writes the marshalling half.
internal static partial class NativeMethods
{
    [LibraryImport("libc", EntryPoint = "abs")]
    internal static partial int Abs(int value);

    [LibraryImport("libc", EntryPoint = "getenv", StringMarshalling = StringMarshalling.Utf8)]
    internal static partial IntPtr GetEnv(string name);

    public static int SafeAbs(int value) => Abs(value);
}

// ONE part on disk. The JSON source generator writes a context class with a
// property per [JsonSerializable] type — members that are REFERENCED below and
// declared nowhere the parser can see.
[JsonSerializable(typeof(Person))]
[JsonSerializable(typeof(List<Person>))]
[JsonSourceGenerationOptions(WriteIndented = true)]
internal partial class SerializerContext : JsonSerializerContext
{
}

public sealed record Person(int Id, string Name);

public static class Serialization
{
    // SerializerContext.Default and .Person are generated members.
    public static string ToJson(Person person) =>
        System.Text.Json.JsonSerializer.Serialize(person, SerializerContext.Default.Person);

    public static Person? FromJson(string json) =>
        System.Text.Json.JsonSerializer.Deserialize(json, SerializerContext.Default.Person);
}

// A single-part partial with NO generator at all — also completely normal, and
// indistinguishable in syntax from the three above. This is the case that makes
// "is this partial waiting for a generator?" unanswerable from source.
public partial class LonePartial
{
    public int Value { get; set; }

    // A C# 2 partial method with no implementation: the declaration and the
    // call are both erased. `Notify()` below compiles to nothing.
    partial void OnValueSet();

    public void Set(int value)
    {
        Value = value;
        OnValueSet();
    }
}

public partial struct LonePartialStruct
{
    public int X;
}

public partial record LonePartialRecord(int Id);

public partial interface ILonePartial
{
    int Get();
}
