// CS-CORPUS-21: nothing inside a `with { ... }` initializer is walked. The
// WITH_EXPRESSION row is emitted and its receiver is walked; the initializer's
// assignments, operators and calls produce no rows at all. The CONTROL is the
// same initializer written as an object initializer on `new`, which is walked.
// Measured at cs-impl@f42baba.
using System;
namespace Fixtures.WalkGaps;

public record WithCore(object? Comparer, Type ClrType);
public class WithHolder
{
    public WithCore Core { get; } = new WithCore(null, typeof(int));
    public WithHolder WithCoreParameters(WithCore c) => this;
}
public class WithBase { public WithBase(WithHolder p) { } }

public class WithInitializerBody : WithBase
{
    // GAP: the with-initializer inside a base(...) argument — the corpus shape.
    public WithInitializerBody(WithHolder parameters)
        : base(parameters.WithCoreParameters(parameters.Core with
        {
            Comparer = parameters.Core.Comparer
                ?? (Environment.Is64BitProcess ? MakeComparer(parameters.Core.ClrType) : throw new InvalidOperationException("no comparer"))
        })) { }

    // GAP: the same initializer in an expression body — no base initializer involved.
    public static WithCore Rewrite(WithCore c) => c with
    {
        Comparer = c.Comparer ?? (Environment.Is64BitProcess ? MakeComparer(c.ClrType) : throw new InvalidOperationException("no comparer"))
    };

    // GAP: a plain call in a with-initializer.
    public static WithCore Plain(WithCore c) => c with { Comparer = MakeComparer(c.ClrType) };

    // CONTROL: the same expression as an object initializer on `new` — walked.
    public static WithCoreMutable Control(WithCore c) => new WithCoreMutable
    {
        Comparer = c.Comparer ?? (Environment.Is64BitProcess ? MakeComparer(c.ClrType) : throw new InvalidOperationException("no comparer"))
    };

    private static object MakeComparer(Type t) => t;
}
public class WithCoreMutable { public object? Comparer { get; set; } }
