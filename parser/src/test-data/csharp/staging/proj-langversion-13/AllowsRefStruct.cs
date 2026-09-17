// HELD CONSTRUCT 3 of 4 — `allows ref struct` (C# 13).
// NOT COMPILABLE IN THIS CHECKOUT. See ../NOT-VERIFIABLE-HERE.
//
// This is an ANTI-CONSTRAINT: it does not narrow what `T` may be, it WIDENS it,
// by lifting the rule that a `ref struct` may never be a type argument. In
// exchange the method body must treat `T` as if it were a ref struct — no
// boxing, no capture in a lambda, no use in an async or iterator method, no
// conversion to `object`.
//
// It is a constraint whose presence REMOVES obligations from the caller and ADDS
// them to the callee, which is the opposite direction from every other
// constraint in the language, and it is the reason `Span<T>` finally became
// usable with generic algorithms.
//
// The schema's `cs_type_parameter` carries `hasAllowRefStructConstraint`
// specifically for this. Until this file builds, that column has no fixture.
//
// Related C# 13: a `ref struct` may now IMPLEMENT AN INTERFACE. The compiling
// C# 12 shape — a ref struct with no base list and a comment saying why — is at
// ../ported/type-references/HeritageClauses.cs.
using System;
using System.Collections.Generic;

namespace Fixtures.LangVersion13;

// A ref struct that IMPLEMENTS an interface — illegal before C# 13, and only
// legal now because the interface is never reached through a boxed receiver.
public ref struct Cursor : IDisposable
{
    private readonly ReadOnlySpan<char> text;
    private int position;

    public Cursor(ReadOnlySpan<char> text)
    {
        this.text = text;
        position = 0;
    }

    public readonly char Current => text[position - 1];

    public bool MoveNext() => ++position <= text.Length;

    public void Dispose() => position = 0;
}

public static class AllowsRefStruct
{
    // The anti-constraint alone.
    public static int Count<T>(T value)
        where T : allows ref struct
        => 1;

    // Combined with an ordinary constraint. Order matters: `allows ref struct`
    // must come LAST in the clause.
    public static void Use<T>(T value)
        where T : IDisposable, allows ref struct
    {
        value.Dispose();
    }

    public static T Create<T>()
        where T : struct, allows ref struct
        => default;

    // On a TYPE's parameter rather than a method's.
    public ref struct Wrapper<T>
        where T : allows ref struct
    {
        public T Value;
    }

    // On a DELEGATE's type parameter.
    public delegate void Handler<T>(T value) where T : allows ref struct;

    // On an INTERFACE's type parameter, which is what makes a generic
    // abstraction over spans expressible at all.
    public interface IProcessor<T>
        where T : allows ref struct
    {
        int Process(T value);
    }

    public ref struct SpanProcessor : IProcessor<Cursor>
    {
        public int Process(Cursor value) => value.MoveNext() ? 1 : 0;
    }

    // What the anti-constraint COSTS inside the body. Each of these is a
    // compile error under `allows ref struct` and legal without it, so the
    // constraint changes the meaning of the body and not only the signature.
    public static int Restricted<T>(T value)
        where T : allows ref struct
    {
        // object boxed = value;            // illegal: may not box
        // Func<T> captured = () => value;  // illegal: may not capture
        // var list = new List<T>();        // illegal: T may be a ref struct
        // return value.ToString().Length;  // illegal: virtual call boxes
        return 0;
    }

    // The same method WITHOUT the anti-constraint, for contrast: all four of
    // the above are fine here, and `Span<int>` may not be passed.
    public static int Unrestricted<T>(T value)
    {
        object boxed = value!;
        Func<T> captured = () => value;
        var list = new List<T> { value };
        return boxed.GetHashCode() + captured()!.GetHashCode() + list.Count;
    }

    public static int CallSites()
    {
        // A ref struct as a TYPE ARGUMENT — the thing the anti-constraint
        // exists to permit.
        Span<int> span = stackalloc int[4];
        int a = Count(span);

        ReadOnlySpan<char> chars = "abc".AsSpan();
        int b = Count(chars);

        var cursor = new Cursor(chars);
        Use(cursor);
        int c = Count(cursor);

        // An ordinary type argument still works: the anti-constraint widens.
        int d = Count(42);
        int e = Count("string");

        // Unrestricted<T> may NOT take a ref struct:
        // int f = Unrestricted(span);   // illegal: Span<int> is a ref struct
        int f = Unrestricted(42);

        var wrapper = new Wrapper<Span<int>> { Value = span };

        return a + b + c + d + e + f + wrapper.Value.Length;
    }
}
