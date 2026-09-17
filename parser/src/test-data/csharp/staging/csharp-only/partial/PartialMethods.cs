// HALF TWO — partial METHODS, both dialects.
//
// A partial method's DECLARATION and IMPLEMENTATION are separate members that
// merge into one. Two dialects exist and they are not the same construct:
//
//   * C# 2 partial methods: implicitly private, must return void, no `out`
//     parameters, no accessibility modifier. If NO implementation is supplied,
//     the declaration AND EVERY CALL TO IT ARE ERASED — a call site that
//     resolves to nothing and generates no IL. This is the source-generator
//     hook, and it is the case a call-graph model must not report as a
//     dangling edge.
//   * C# 9 extended partial methods: may have any accessibility, any return
//     type and `out` parameters — and then an implementation is REQUIRED.
//
// Both are here, in the same type, plus one declaration with no implementation
// at all and a call to it.
using System;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.Partials;

public partial class PartialMethodHost
{
    // C# 2 dialect — DECLARATION only, implemented in the other part below.
    partial void OnCreated();

    partial void OnChanged(string propertyName);

    // C# 2 dialect — DECLARATION WITH NO IMPLEMENTATION ANYWHERE. Legal. The
    // method does not exist in the emitted assembly and the call below is
    // removed entirely, arguments and all.
    partial void OnNeverImplemented(int value);

    // C# 9 dialect — declaration with an accessibility modifier and a non-void
    // return type. An implementation is mandatory.
    public partial string Format(int value);

    private partial bool TryCompute(int input, out int result);

    internal partial void ExplicitlyInternal();

    public PartialMethodHost()
    {
        OnCreated();

        // This call is ERASED at compile time, together with the evaluation of
        // its argument. `Side()` never runs.
        OnNeverImplemented(Side());

        OnChanged(nameof(PartialMethodHost));
    }

    private static int Side()
    {
        Console.WriteLine("never printed");
        return 1;
    }

    public string Use(int value)
    {
        string formatted = Format(value);
        return TryCompute(value, out int computed) ? formatted + computed : formatted;
    }
}

public partial class PartialMethodHost
{
    private readonly List<string> log = new();

    // C# 2 dialect — the IMPLEMENTATION halves.
    partial void OnCreated() => log.Add("created");

    partial void OnChanged(string propertyName)
    {
        log.Add("changed:" + propertyName);
    }

    // C# 9 dialect — the implementing declarations. The signature, including
    // parameter names, must match; only the body is added.
    public partial string Format(int value) => value.ToString("D4");

    private partial bool TryCompute(int input, out int result)
    {
        result = input * 2;
        return input > 0;
    }

    internal partial void ExplicitlyInternal() => log.Add("internal");

    public IReadOnlyList<string> Log => log;
}

// The same split for a partial PROPERTY is NOT legal in C# 12 — partial
// properties arrived in C# 13. Recorded, not invented: this project is
// LangVersion 12 and there is no partial property fixture here.
