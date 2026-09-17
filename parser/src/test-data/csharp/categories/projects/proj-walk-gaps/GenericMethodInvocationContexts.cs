// CS-CORPUS-26: a GENERIC METHOD invocation `recv.M<T>(args)` is lost where its
// `<`..`>` reads as comparison operators: preceded by a cast, on a creation
// receiver, or followed by an arithmetic/bitwise operator -- WHEN the type
// arguments are identifiers. With keyword types (`M<float, double>(x) * y`) the
// grammar has no ambiguity and the call is walked; the corpus sites all use type
// parameters or class names. Roslyn's typeArgCount is what the classifier keys on. The sibling of CS-CORPUS-22
// (fork rule 8 covered creations; this is the invocation side). 47 corpus sites.
// Measured at cs-impl@888985c (fork8).
using System;
using System.Collections.Generic;
namespace Fixtures.WalkGaps;

public class GmBase { public virtual GmBase HasConversion<TConversion>(object? comparer) => this; }
public class GmDerived<TProperty> : GmBase
{
    // GAP: cast prefix — `(T)base.M<X>(arg)`.
    public new GmDerived<TProperty> HasConversion<TConversion>(object? comparer)
        => (GmDerived<TProperty>)base.HasConversion<TConversion>(comparer);
}
public class GmA { } public class GmB { }
public class GmCollection { public GmCollection Add<T>() => this; public GmCollection AddFactory<T>(Action<T> configure) => this; }
public static class GmUnsafe { public static TTo BitCast<TFrom, TTo>(TFrom v) => default!; public static TTo Widen<TFrom, TTo>(TFrom v) => default!; public static TTo Widen<TFrom, TTo>(TFrom v, int n) => default!; }

public class GenericMethodInvocationContexts
{
    // GAP: on a creation receiver, under a cast — the corpus's test-fixture shape.
    public static object OnCreationReceiverUnderCast()
        => (IDisposable?)new GmCollection().AddFactory<GmCollection>(c => { }) ?? new System.IO.MemoryStream();

    // NOT REPRODUCED at 888985c (kept as a control): fluent generic calls on a creation receiver — walked.
    public static void OnCreationReceiverFluent()
    {
        new GmCollection()
            .Add<GmA>()
            .Add<GmB>();
    }

    // NOT REPRODUCED at 888985c (kept as a control): inside an argument list, followed by an operator.
    // The corpus's thirteen bcl-slice sites (`Unsafe.BitCast<TVectorDouble, TVectorUInt64>(value) &
    // TVectorUInt64.Create(mask)`, `Widen<TVectorSingle, TVectorDouble>(degrees) * scale` as tuple
    // elements) are NOT reproduced by any form in this file; they are handed over by site.
    public static double InArgumentListFollowedByOperator<TA, TB>(TA value, double scale)
    {
        var d = Pair(GmUnsafe.Widen<TA, double>(value) * scale, 2);
        var e = Pair(GmUnsafe.BitCast<TA, ulong>(value) & 0xFFul, 3);
        return d + e;
    }
    private static double Pair(double a, int b) => a + b;
    private static double Pair(ulong a, int b) => a + (ulong)b;

    // NOT REPRODUCED at 888985c (kept as a control): followed by an operator OUTSIDE an argument list,
    // identifier type arguments — walked.
    public static double FollowedByOperatorOutsideArguments<TA>(TA value, double scale)
    {
        var a = GmUnsafe.Widen<TA, double>(value) * scale;
        var b = GmUnsafe.BitCast<TA, ulong>(value) & 0xFFul;
        return a + b;
    }

    // CONTROL: the same three with KEYWORD type arguments — no ambiguity, walked.
    public static double FollowedByOperatorKeywordTypes(double value, double scale)
    {
        double a = GmUnsafe.Widen<float, double>((float)value) * scale;
        ulong b = GmUnsafe.BitCast<double, ulong>(value) & 0xFFul;
        ulong c = GmUnsafe.BitCast<double, ulong>(value) - 1ul;
        return a + b + c;
    }

    // CONTROL: the same invocations as a plain statement, an argument, and a return value — walked.
    public static object Control(double value)
    {
        var coll = new GmCollection();
        coll.Add<int>();
        Consume(GmUnsafe.BitCast<double, ulong>(value));
        return GmUnsafe.Widen<float, double>((float)value);
    }
    private static void Consume(ulong u) { }
}
