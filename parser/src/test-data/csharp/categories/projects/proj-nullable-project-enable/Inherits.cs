// NO #nullable DIRECTIVE. This file inherits `enable` from the .csproj, so
// every unannotated reference type is non-nullable and `string?` is meaningful.
// Its facts differ from the byte-identical file in
// ../proj-nullable-project-disable/Inherits.cs, which inherits `disable`.
using System;

namespace Fixtures.NullableEnable;

public class Inherits
{
    // Non-nullable: the compiler requires it to be initialised.
    public string Required { get; set; } = string.Empty;

    // Nullable: the `?` is an ANNOTATION on the type reference, and it changes
    // the meaning without changing the name.
    public string? Optional { get; set; }

    public int? OptionalValue { get; set; }

    public string?[] ArrayOfNullable = Array.Empty<string?>();

    public string[]? NullableArray;

    public System.Collections.Generic.List<string?>? Both;

    public string Describe(string? input)
    {
        // ?. — null-conditional access, which propagates null.
        int? length = input?.Length;

        // ?? — null-coalescing.
        string safe = input ?? "fallback";

        // ??= — null-coalescing assignment.
        string? local = null;
        local ??= "assigned";

        // ! — the null-forgiving operator. It suppresses the warning and
        // asserts nothing at runtime; it is the one place the annotation
        // system is overridden by the author.
        string forced = input!;
        int forcedLength = input!.Length;

        // A chain mixing all four.
        string chained = input?.Trim() ?? Optional ?? forced;

        return $"{length}{safe}{local}{forcedLength}{chained}";
    }

    // Nullable generic constraints and annotations, which need an enabled
    // context to be written at all.
    public T? MaybeDefault<T>() where T : class? => default;

    public T NotNull<T>(T value) where T : notnull => value;

    public T? MaybeStruct<T>() where T : struct => null;
}
