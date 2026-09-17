// HALF TWO — LOCAL FUNCTIONS. A method declared inside a method body, with a
// name, a signature, type parameters, attributes and a body — and no type of
// its own, no accessibility, and no entry in the containing type's member list.
//
// Java has no local function; its local CLASS is the nearest thing and C# has
// no local class, so the two languages' answers to "declare something small
// near where it is used" do not overlap at all.
//
// The distinctions a parser must keep:
//   * a local function may be declared AFTER its call site (unlike a lambda);
//   * `static` on one forbids capture, which changes whether a closure is
//     allocated;
//   * a local function may be an ITERATOR or ASYNC, with the two-method-split
//     validation shape that makes it worth having;
//   * it may be recursive and mutually recursive, which a lambda cannot be
//     without an explicit declaration first.
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Fixtures.CSharpOnly.Functions;

public class LocalFunctions
{
    private int field = 1;

    // Declared AFTER the call — a forward reference a lambda cannot make.
    public int DeclaredAfterUse(int seed)
    {
        return Helper(seed);

        int Helper(int value) => value + 1;
    }

    // Every declaration shape.
    public int Shapes(int seed)
    {
        // Expression-bodied and block-bodied.
        int Expression(int x) => x + 1;

        int Block(int x)
        {
            int doubled = x * 2;
            return doubled;
        }

        // void, and one returning a reference type.
        void NoResult(int x) => Console.WriteLine(x);

        string Text(int x) => x.ToString();

        // Generic, with a constraint.
        T Identity<T>(T value) => value;

        TOut Convert<TIn, TOut>(TIn input, Func<TIn, TOut> f) where TOut : class => f(input);

        // With optional, params, ref, out and in parameters.
        int Optional(int x, int y = 1) => x + y;

        int Params(params int[] values) => values.Length;

        void ByRef(ref int x) => x++;

        bool ByOut(int x, out int doubled)
        {
            doubled = x * 2;
            return true;
        }

        int ByIn(in int x) => x + 1;

        // With an attribute.
        [Obsolete("local")]
        int Attributed(int x) => x;

        // STATIC: captures nothing, so no display class is allocated and
        // referring to `seed` or `field` here would not compile.
        static int NoCapture(int x) => x * 3;

        // CAPTURING: closes over a parameter, a local and `this`.
        int local = 10;
        int Capturing(int x) => x + seed + local + field;

        // Nested inside another local function.
        int Outer(int x)
        {
            return Inner(x) + 1;

            int Inner(int y) => y * 2;
        }

        int refArg = 1;
        ByRef(ref refArg);
        ByOut(1, out int outArg);
        NoResult(1);

        return Expression(1) + Block(1) + Text(1).Length + Identity(1)
            + (Convert(1, x => x.ToString())?.Length ?? 0) + Optional(1) + Params(1, 2)
            + refArg + outArg + ByIn(1) + Attributed(1) + NoCapture(1) + Capturing(1)
            + Outer(1);
    }

    // RECURSION and MUTUAL recursion — the case a lambda needs a pre-declared
    // variable for.
    public int Recursion(int n)
    {
        return Factorial(n) + IsEven(n).GetHashCode();

        int Factorial(int x) => x <= 1 ? 1 : x * Factorial(x - 1);

        bool IsEven(int x) => x == 0 || IsOdd(x - 1);

        bool IsOdd(int x) => x != 0 && IsEven(x - 1);
    }

    // A local function that is an ITERATOR: this is the two-method split from
    // ../async-iterators/Iterators.cs, done without a second member. The outer
    // method validates eagerly; the local one yields lazily.
    public IEnumerable<int> ValidatedIterator(IEnumerable<int>? source, int take)
    {
        if (source is null)
        {
            throw new ArgumentNullException(nameof(source));
        }

        return Iterate();

        IEnumerable<int> Iterate()
        {
            int emitted = 0;
            foreach (int item in source)
            {
                if (emitted++ >= take)
                {
                    yield break;
                }

                yield return item;
            }
        }
    }

    // The same shape for async: eager validation, lazy await.
    public Task<int> ValidatedAsync(string? raw)
    {
        if (raw is null)
        {
            throw new ArgumentNullException(nameof(raw));
        }

        return Run();

        async Task<int> Run()
        {
            await Task.Yield();
            return raw.Length;
        }
    }

    // An async local function, an async static local function, and one
    // returning IAsyncEnumerable.
    public async Task<int> AsyncLocals(int seed)
    {
        async Task<int> Capturing() => await Task.FromResult(seed);

        static async Task<int> NotCapturing(int x) => await Task.FromResult(x);

        async IAsyncEnumerable<int> Stream()
        {
            await Task.Yield();
            yield return seed;
        }

        int total = await Capturing() + await NotCapturing(1);
        await foreach (int value in Stream())
        {
            total += value;
        }

        return total;
    }

    // A local function versus a LAMBDA with the same body: same behaviour,
    // different allocation, different declaration order rules, and different
    // rows. Having both side by side is the point.
    public int LocalVersusLambda(int seed)
    {
        int LocalForm(int x) => x + seed;

        Func<int, int> LambdaForm = x => x + seed;

        // A lambda cannot be referenced before its declaration; a local
        // function can. A lambda is a delegate INSTANCE; a local function is
        // not a value at all until it is converted to one.
        Func<int, int> converted = LocalForm;

        return LocalForm(1) + LambdaForm(1) + converted(1);
    }

    // A local function in an accessor, a constructor, an operator and a lambda
    // body — every member kind that has a body.
    public int Property
    {
        get
        {
            int Inner() => field;
            return Inner();
        }
    }

    public LocalFunctions()
    {
        int Init() => 1;
        field = Init();
    }

    public static LocalFunctions operator +(LocalFunctions left, LocalFunctions right)
    {
        int Sum() => left.field + right.field;
        return new LocalFunctions { field = Sum() };
    }

    public Func<int, int> ReturnsLambdaContainingLocalFunction() => x =>
    {
        int Inner(int y) => y * 2;
        return Inner(x);
    };
}
