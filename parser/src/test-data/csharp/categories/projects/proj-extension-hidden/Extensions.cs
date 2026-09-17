// The DECLARING half of the extension-visibility pair. This file is
// BYTE-IDENTICAL in proj-extension-visible/ and proj-extension-hidden/; the
// only difference between the two projects is one `using` line in Consumer.cs.
//
// An extension method is declared on one type (the static class Acme.Text.
// StringExtensions) and invoked on another (System.String). The receiver in
// the syntax is not the declaring type, and only the `using` directives in
// scope decide whether the method is visible at all.
using System;
using System.Collections.Generic;
using System.Text;

namespace Acme.Text;

public static class StringExtensions
{
    // The `this` marker on the first parameter is the whole declaration.
    public static string Slugify(this string source)
    {
        var builder = new StringBuilder(source.Length);
        foreach (char c in source)
        {
            builder.Append(char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : '-');
        }

        return builder.ToString();
    }

    public static string Truncate(this string source, int maxLength) =>
        source.Length <= maxLength ? source : source.Substring(0, maxLength);

    public static bool IsBlank(this string? source) => string.IsNullOrWhiteSpace(source);

    // An extension on a GENERIC type, with its own type parameter.
    public static IEnumerable<T> Repeat<T>(this T value, int times)
    {
        for (int i = 0; i < times; i++)
        {
            yield return value;
        }
    }

    // An extension on an INTERFACE — the receiver may be any implementer.
    public static string JoinWith<T>(this IEnumerable<T> source, string separator) =>
        string.Join(separator, source);

    // An extension on a VALUE type.
    public static bool IsEven(this int value) => value % 2 == 0;

    // An extension on a NULLABLE value type.
    public static int OrZero(this int? value) => value ?? 0;
}
