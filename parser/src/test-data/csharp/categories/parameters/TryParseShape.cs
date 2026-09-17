// HALF TWO — the TryParse shape, where the `out` parameter IS THE RESULT and
// the return value is only a success flag.
//
// This is in every C# codebase written, and it is the case that decides whether
// an engine's dataflow is right: `int.TryParse(s, out var n)` flows `s` into
// `n`, and the boolean carries nothing. A model that follows return values only
// sees a bool appear from a string and no other edge.
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;

namespace Fixtures.CSharpOnly.Parameters;

public sealed class Config
{
    public required string Name { get; init; }

    public int Retries { get; init; }
}

public static class TryParseShape
{
    // The canonical BCL shapes.
    public static int ParseOrDefault(string text) =>
        int.TryParse(text, out int value) ? value : 0;

    public static double ParseWithCulture(string text) =>
        double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double value)
            ? value
            : 0d;

    public static DateTime ParseDate(string text) =>
        DateTime.TryParse(text, out DateTime value) ? value : DateTime.MinValue;

    public static Guid ParseGuid(string text) =>
        Guid.TryParse(text, out Guid value) ? value : Guid.Empty;

    public static TEnum ParseEnum<TEnum>(string text)
        where TEnum : struct, Enum
        => Enum.TryParse(text, ignoreCase: true, out TEnum value) ? value : default;

    // The dictionary shape, which is the same pattern on a collection.
    public static int Lookup(IDictionary<string, int> map, string key) =>
        map.TryGetValue(key, out int found) ? found : -1;

    // A USER-DEFINED TryParse, with the nullability attributes that tell the
    // compiler `result` is non-null exactly when the method returns true. Those
    // attributes are the only thing linking the two channels, and they are
    // metadata, not syntax.
    public static bool TryParseConfig(
        string? raw,
        [NotNullWhen(true)] out Config? config,
        [NotNullWhen(false)] out string? error)
    {
        config = null;
        error = null;

        if (string.IsNullOrWhiteSpace(raw))
        {
            error = "empty";
            return false;
        }

        string[] parts = raw.Split(':');
        if (parts.Length != 2 || !int.TryParse(parts[1], out int retries))
        {
            error = "malformed";
            return false;
        }

        config = new Config { Name = parts[0], Retries = retries };
        return true;
    }

    // A Try* returning the result through `out` AND a nullable return, which is
    // the same information twice and is what the modern BCL moved away from.
    public static bool TryFind(IReadOnlyList<Config> source, string name, out Config? found)
    {
        foreach (Config candidate in source)
        {
            if (candidate.Name == name)
            {
                found = candidate;
                return true;
            }
        }

        found = null;
        return false;
    }

    // The NULLABLE-RETURN alternative to the whole pattern, for contrast: one
    // channel instead of two.
    public static Config? FindOrNull(IReadOnlyList<Config> source, string name)
    {
        foreach (Config candidate in source)
        {
            if (candidate.Name == name)
            {
                return candidate;
            }
        }

        return null;
    }

    // Every call-site shape the pattern takes in real code.
    public static string CallSites(string raw, IReadOnlyList<Config> source, IDictionary<string, int> map)
    {
        // Declared inline, used in the true branch only.
        if (int.TryParse(raw, out int parsed))
        {
            Console.WriteLine(parsed);
        }

        // Declared inline, used after the `if` — legal because the binding's
        // scope is the enclosing block, not the branch.
        if (!int.TryParse(raw, out int later))
        {
            later = -1;
        }

        // Negated, with an early return, which is the guard-clause form.
        if (!TryParseConfig(raw, out Config? config, out string? error))
        {
            return error;
        }

        // `out var`.
        map.TryGetValue(raw, out var count);

        // Discarded: the flag is the only thing wanted.
        bool isNumeric = int.TryParse(raw, out _);

        // Chained through &&, where the second call's `out` is only definitely
        // assigned because the first returned true.
        if (TryFind(source, raw, out Config? found) && found.Retries > 0)
        {
            Console.WriteLine(found.Name);
        }

        // Inside a ternary, inside an argument, and inside a lambda.
        int viaTernary = int.TryParse(raw, out int t) ? t : 0;
        Console.WriteLine(int.TryParse(raw, out int inArgument) ? inArgument : 0);
        Func<string, int> inLambda = s => int.TryParse(s, out int inner) ? inner : 0;

        // In a `while` condition, where the out is reassigned every iteration.
        var queue = new Queue<string>();
        while (queue.Count > 0 && int.TryParse(queue.Dequeue(), out int fromQueue))
        {
            Console.WriteLine(fromQueue);
        }

        // Pre-declared, passed with the modifier at the call site.
        int preDeclared;
        int.TryParse(raw, out preDeclared);

        return $"{parsed}{later}{config.Name}{count}{isNumeric}{viaTernary}{inLambda(raw)}{preDeclared}";
    }
}
