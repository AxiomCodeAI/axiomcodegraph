// HELD CONSTRUCT 1 of 4 — `ref readonly` PARAMETERS (C# 13).
// NOT COMPILABLE IN THIS CHECKOUT. See ../NOT-VERIFIABLE-HERE.
//
// `ref readonly` completes the parameter-mode set. It is `in` with the call
// site forced to say so: the callee may not assign it, the caller must write
// `ref` or `in`, and passing an rvalue is a warning rather than silent
// temporary creation. The schema already reserves
// `cs_method_parameter.parameterMode = REF_READONLY` for it, and until this
// file can be built that value has no fixture and must carry a zero-row
// assertion.
//
// `ref readonly` LOCALS and RETURNS are C# 7.2 and ARE covered, compiling, at
// ../csharp-only/parameters/ParameterModes.cs. Only the PARAMETER is C# 13.
using System;

namespace Fixtures.LangVersion13;

public readonly struct LargeValue
{
    public readonly double A;
    public readonly double B;
    public readonly double C;
    public readonly double D;

    public LargeValue(double a, double b, double c, double d)
    {
        A = a;
        B = b;
        C = c;
        D = d;
    }
}

public static class RefReadonlyParameters
{
    // The C# 13 mode. Contrast with `in` immediately below: identical
    // semantics inside the callee, different obligations at the call site.
    public static double Sum(ref readonly LargeValue value) =>
        value.A + value.B + value.C + value.D;

    public static double SumViaIn(in LargeValue value) =>
        value.A + value.B + value.C + value.D;

    // `ref readonly` beside every other mode in one signature, so the whole
    // parameterMode vocabulary appears in one row set.
    public static bool Everything(
        int byValue,
        in int byIn,
        ref readonly LargeValue byRefReadonly,
        ref int byRef,
        out int byOut,
        params int[] rest)
    {
        byOut = byValue + byIn + (int)byRefReadonly.A + byRef + rest.Length;
        byRef = byOut;
        return byOut > 0;
    }

    // On a delegate, a lambda and a local function — the signature-matching
    // rule applies to all three, as it does for `ref` and `out`.
    public delegate double Reader(ref readonly LargeValue value);

    public static double ThroughDelegate(LargeValue value)
    {
        Reader viaLambda = (ref readonly LargeValue v) => v.A;

        double Local(ref readonly LargeValue v) => v.B;

        return viaLambda(in value) + Local(in value);
    }

    // Call sites. `ref` and `in` are both accepted; omitting the modifier
    // entirely is a WARNING (CS9192), not an error — which is the whole
    // difference from `ref`, and the reason the mode exists.
    public static double CallSites()
    {
        var value = new LargeValue(1, 2, 3, 4);

        double withRef = Sum(ref value);
        double withIn = Sum(in value);

        int refArg = 1;
        Everything(1, 2, in value, ref refArg, out int outArg, 3, 4);

        return withRef + withIn + refArg + outArg + ThroughDelegate(value);
    }

    // A `ref readonly` parameter on an extension method — `in this` already
    // exists at C# 12; this is the explicit form.
    public static double Magnitude(ref readonly this LargeValue value) =>
        Math.Sqrt((value.A * value.A) + (value.B * value.B));
}
