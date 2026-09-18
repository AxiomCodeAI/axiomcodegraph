// #if GUARDING DECLARATIONS, WITH AUTHORED SYMBOLS.
//
// The corpus measurement behind schema §2.2: 57.8% of #if regions guard a
// DECLARATION and only 25.2% guard a statement — a 2.3:1 ratio the other way
// from the intuition that #if is mostly about statements. Every region below
// is a declaration-level one, classified with the schema's own vocabulary
// (TYPE_LEVEL / DECLARATION / STATEMENT / ENUM_MEMBERS / FRAGMENT / EMPTY) in a
// comment, so the classifier can be checked against a known answer.
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

// A CONDITIONAL USING. A using clause must precede every other element, so a
// guarded one can only live up here — which means the set of import rows for
// this module is a function of DefineConstants, exactly as the set of type rows
// is.
#if FEATURE_DIAGNOSTICS
using Diagnostics = System.Diagnostics;
#endif
#if HAVE_REFLECTION_EMIT
using Emit = System.Reflection.Emit;
#endif

namespace Fixtures.DefineConstants;

// regionShape = TYPE_LEVEL. The whole type is conditional; the symbol IS
// defined, so this type exists.
#if HAVE_SPANS
public readonly ref struct Window
{
    public Window(ReadOnlySpan<byte> data) => Data = data;

    public ReadOnlySpan<byte> Data { get; }

    public int Length => Data.Length;
}
#endif

// regionShape = TYPE_LEVEL, symbol NOT defined. This type exists in NO
// emission. tree-sitter parses it; Roslyn never sees it; the module row says
// the region is inactive and no child row may be emitted from inside it.
#if HAVE_REFLECTION_EMIT
public sealed class EmitHelper
{
    public System.Reflection.Emit.DynamicMethod Build() => throw new NotImplementedException();

    public int Unreferenced => ThisTypeDoesNotExist.Value;
}
#endif

public class Feature
{
    // regionShape = DECLARATION, defined.
#if HAVE_ASYNC
    public async Task<int> LoadAsync()
    {
        await Task.Yield();
        return 1;
    }

    public async ValueTask<int> LoadValueAsync() => await LoadAsync();
#endif

    // regionShape = DECLARATION with an #else. Exactly one of these two methods
    // exists, and both are parsed by any both-branches parser.
#if HAVE_SPANS
    public int Sum(ReadOnlySpan<int> values)
    {
        int total = 0;
        foreach (int v in values)
        {
            total += v;
        }

        return total;
    }
#else
    public int Sum(int[] values)
    {
        int total = 0;
        foreach (int v in values)
        {
            total += v;
        }

        return total;
    }
#endif

    // regionShape = DECLARATION, NOT defined, with an #else that IS live.
#if FEATURE_SERIALIZATION
    public string Serialize(object value) => System.Text.Json.JsonSerializer.Serialize(value);
#else
    public string Serialize(object value) => value?.ToString() ?? string.Empty;
#endif

    // regionShape = FRAGMENT: the guarded text is not independently parseable —
    // it is one attribute, one modifier and one parameter of a declaration
    // whose other parts are outside the region. Schema §2.2 records these with
    // no child rows, because there is no complete construct inside to emit.
    [Obsolete]
#if FEATURE_DIAGNOSTICS
    [System.Diagnostics.Conditional("DEBUG")]
#endif
    public static void Trace(
        string message
#if FEATURE_DIAGNOSTICS
        ,
        [System.Runtime.CompilerServices.CallerMemberName] string caller = ""
#endif
        )
    {
        Console.WriteLine(message);
    }

    // FRAGMENT again, splitting an expression across the directive.
    public int Total(int a, int b) =>
        a
#if HAVE_SPANS
        + b
#else
        - b
#endif
        ;

    // regionShape = STATEMENT, the 25.2% case.
    public void Log(string message)
    {
#if FEATURE_DIAGNOSTICS
        System.Diagnostics.Debug.WriteLine(message);
#endif
        Console.WriteLine(message);
    }

    // regionShape = EMPTY: a region whose body is blank. Rare (2 in the whole
    // measured corpus) and worth having, because a classifier with no EMPTY
    // bucket silently mislabels it.
#if HAVE_ASYNC
#endif

    // A region guarding a CONSTRUCTOR and a nested type together.
#if HAVE_ASYNC
    public Feature()
    {
        Mode = "async";
    }

    public sealed class Options
    {
        public int Timeout { get; set; }
    }
#else
    public Feature()
    {
        Mode = "sync";
    }
#endif

    public string Mode { get; }
}

// regionShape = ENUM_MEMBERS. The numeric value of `All` differs between
// configurations because the members before it do.
public enum Capability
{
    None = 0,
#if HAVE_ASYNC
    Async,
#endif
#if HAVE_SPANS
    Spans,
#endif
#if FEATURE_SERIALIZATION
    Serialization,
#endif
    All
}

public class UsesConditionalAlias
{
#if FEATURE_DIAGNOSTICS
    public Diagnostics.Stopwatch Timer { get; } = new Diagnostics.Stopwatch();
#endif

    public int Value => 1;
}

// A guarded PARTIAL part: one part is conditional, so the type has two
// declaration sites under one configuration and one under the other. The
// partial group's SIZE is a function of the governing configuration.
public partial class ConditionalPartial
{
    public int Always;
}

#if HAVE_SPANS
public partial class ConditionalPartial
{
    public int OnlyWithSpans;
}
#endif

#if HAVE_REFLECTION_EMIT
public partial class ConditionalPartial
{
    public int NeverPresent;
}
#endif
