// HALF TWO — parameter MODES. `out` is a SECOND RETURN CHANNEL, and an engine
// that models only return values loses that dataflow entirely.
//
// The schema puts the mode in a COLUMN, not in the kind:
//   parameterMode ∈ VALUE · REF · OUT · IN · REF_READONLY · PARAMS · THIS
//
// `ref readonly` PARAMETERS are C# 13 and are therefore ABSENT from this
// project, which is LangVersion 12. Recorded, not simulated. `ref readonly`
// LOCALS and RETURNS are C# 7.2 and are present.
using System;
using System.Collections.Generic;
using System.Globalization;

namespace Fixtures.CSharpOnly.Parameters;

public class ParameterModes
{
    // VALUE — the default. A copy; writing to it is invisible to the caller.
    public int ByValue(int value)
    {
        value = 99;
        return value;
    }

    public void ByValueReference(List<int> list)
    {
        // The REFERENCE is copied, so reassigning is invisible...
        list = new List<int>();

        // ...but mutating the object it pointed at is not. The two are
        // constantly confused and they are different edges.
        list.Add(1);
    }

    // REF — an alias. The caller must already have assigned it, and both sides
    // see every write.
    public void ByRef(ref int value)
    {
        value = 99;
    }

    public void ByRefStruct(ref Point point)
    {
        point.X = 99;
    }

    public void ByRefReassign(ref List<int> list)
    {
        list = new List<int> { 1 };
    }

    // OUT — a second return channel. The callee MUST assign it before
    // returning, and the caller need not have assigned it before calling.
    public void ByOut(out int value)
    {
        value = 99;
    }

    public void TwoOut(out int first, out string second)
    {
        first = 1;
        second = "two";
    }

    public bool MixedOut(int input, out int doubled, out int tripled)
    {
        doubled = input * 2;
        tripled = input * 3;
        return input > 0;
    }

    // IN — a readonly alias. No copy for large structs, and the callee may not
    // assign it. Callers need not write `in` at the call site.
    public decimal ByIn(in Money money) => money.Amount;

    public int ByInPrimitive(in int value) => value + 1;

    // PARAMS — variadic. Must be last, must be a single-dimensional array in
    // C# 12 (params collections are C# 13 and absent here).
    public int ByParams(params int[] values) => values.Length;

    public int ParamsAfterRequired(string first, params object[] rest) => first.Length + rest.Length;

    public int ParamsOfReferences(params string[] values) => values.Length;

    // SCOPED — a lifetime restriction on a ref or ref-like parameter (C# 11).
    // It is NOT a mode: it composes WITH `ref`/`in`/`out`/by-value, which is
    // why the schema carries it in its own column, `scopedModifier`, rather
    // than as another `parameterMode` value. It promises the callee will not
    // let the reference outlive the call, which is what makes returning a
    // `Span` from a method that takes one safe to reason about.
    public int ScopedRef(scoped ref int value) => value + 1;

    public int ScopedIn(scoped in Money money) => (int)money.Amount;

    public int ScopedRefStruct(scoped Span<int> values) => values.Length;

    public int ScopedReadOnlySpan(scoped ReadOnlySpan<char> text) => text.Length;

    // `scoped` beside an UNSCOPED parameter of the same shape, so the two rows
    // differ in exactly one column.
    public int ScopedAndNot(scoped Span<int> restricted, Span<int> unrestricted) =>
        restricted.Length + unrestricted.Length;

    // On a local function, a lambda and a delegate — the modifier is part of
    // the signature everywhere a signature appears.
    public delegate int ScopedReader(scoped ReadOnlySpan<char> text);

    public int ScopedElsewhere(string source)
    {
        ScopedReader viaLambda = (scoped ReadOnlySpan<char> t) => t.Length;

        int Local(scoped ReadOnlySpan<char> t) => t.Length;

        return viaLambda(source.AsSpan()) + Local(source.AsSpan());
    }

    // THIS — the extension-method marker, which is a parameter mode and not a
    // modifier on the method. Covered in depth in ../extensions/.
    // (declared in the static class at the bottom of this file)

    // Every mode in ONE signature, in the legal order.
    public bool Everything(
        int byValue,
        in int byIn,
        ref int byRef,
        out int byOut,
        int optional = 1,
        params int[] rest)
    {
        byOut = byValue + byIn + byRef + optional + rest.Length;
        byRef = byOut;
        return byOut > 0;
    }

    // Modes on a DELEGATE, on a LAMBDA, on a LOCAL FUNCTION and on a
    // CONSTRUCTOR — the signature-matching rule applies to all of them.
    public delegate bool TryTransform(in int input, out int output);

    public ParameterModes(out int assigned) => assigned = 1;

    public ParameterModes()
    {
    }

    public void ModesElsewhere()
    {
        TryTransform viaLambda = (in int input, out int output) =>
        {
            output = input * 2;
            return true;
        };

        bool LocalFunction(ref int value, out int doubled)
        {
            doubled = value * 2;
            value = doubled;
            return true;
        }

        int seed = 1;
        _ = viaLambda(in seed, out int fromLambda);
        _ = LocalFunction(ref seed, out int fromLocal);
        _ = fromLambda + fromLocal;
    }

    // Call sites — the modifier is required at the call site for `ref` and
    // `out`, optional for `in`, and forbidden for `params`.
    public void CallSites()
    {
        int value = 1;

        ByValue(value);
        ByRef(ref value);
        ByOut(out value);
        ByOut(out int declaredInline);
        ByOut(out _);
        ByOut(out var inferred);

        var money = new Money(1m, "GBP");
        _ = ByIn(money);
        _ = ByIn(in money);
        _ = ByInPrimitive(1);
        _ = ByInPrimitive(in value);

        var point = new Point();
        ByRefStruct(ref point);

        List<int> list = new List<int>();
        ByValueReference(list);
        ByRefReassign(ref list);

        _ = ByParams();
        _ = ByParams(1);
        _ = ByParams(1, 2, 3);
        _ = ByParams(new[] { 1, 2, 3 });

        int refArg = 1;
        _ = Everything(1, 2, ref refArg, out int outArg, 3, 4, 5);
        _ = Everything(byValue: 1, byIn: 2, byRef: ref refArg, byOut: out outArg);

        TwoOut(out int a, out string b);
        _ = MixedOut(1, out int c, out int d);

        // An `out` argument in an ARGUMENT of another call, and inside a
        // condition — the positions where the second return channel is
        // easiest to lose.
        Console.WriteLine(MixedOut(1, out int e, out int f) ? e : f);
        if (MixedOut(1, out int g, out int h) && g > h)
        {
            Console.WriteLine(g);
        }

        _ = declaredInline + inferred + outArg + a + b.Length + c + d;
    }

    // `ref` RETURNS and `ref readonly` returns and locals — C# 7.2, no Java
    // form, and the caller receives an alias rather than a value.
    private int[] storage = new int[4];

    public ref int RefReturn(int index) => ref storage[index];

    public ref readonly int RefReadonlyReturn(int index) => ref storage[index];

    public void RefReturnCallSites()
    {
        ref int alias = ref RefReturn(0);
        alias = 42;

        ref readonly int view = ref RefReadonlyReturn(1);

        // Without `ref` on the left the value is COPIED and the alias is lost.
        int copy = RefReturn(0);
        copy = 99;

        _ = view + copy + storage[0];
    }
}

public struct Point
{
    public int X;
    public int Y;
}

public readonly struct Money
{
    public Money(decimal amount, string currency)
    {
        Amount = amount;
        Currency = currency;
    }

    public decimal Amount { get; }

    public string Currency { get; }
}

public static class ThisParameterMode
{
    // THIS — the extension marker. The `this` parameter is position 0 and its
    // type is the RECEIVER at every call site, which is never the declaring
    // type.
    public static int Doubled(this int value) => value * 2;

    // `ref this` on a struct: the extension MUTATES the receiver.
    public static void Bump(ref this Point point) => point.X++;

    // `in this` on a readonly struct: no copy, no mutation.
    public static decimal Halved(in this Money money) => money.Amount / 2;
}
