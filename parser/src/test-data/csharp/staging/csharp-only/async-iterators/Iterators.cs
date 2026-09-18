// HALF TWO — ITERATORS. `yield return` and `yield break` turn a method into a
// state machine whose body runs LAZILY, one segment per MoveNext.
//
// Java has no yield. The consequences a parser must not flatten away:
//   * the method's declared return type is IEnumerable<T>, IEnumerator<T>,
//     IEnumerable or IEnumerator, and the BODY returns T;
//   * nothing in the body runs until the first MoveNext, so argument
//     validation in an iterator is a real bug and the two-method split below
//     is the standard fix;
//   * `yield` may appear inside try/finally but NOT inside catch, and not in a
//     lambda, an unsafe context or a method with ref/out parameters.
using System;
using System.Collections;
using System.Collections.Generic;

namespace Fixtures.CSharpOnly.AsyncIterators;

public class Iterators
{
    // The four legal iterator return types.
    public IEnumerable<int> AsEnumerable()
    {
        yield return 1;
        yield return 2;
    }

    public IEnumerator<int> AsEnumerator()
    {
        yield return 1;
    }

    public IEnumerable AsNonGenericEnumerable()
    {
        yield return 1;
        yield return "two";
    }

    public IEnumerator AsNonGenericEnumerator()
    {
        yield return 1;
    }

    // `yield break` — an early terminal.
    public IEnumerable<int> WithBreak(int limit)
    {
        for (int i = 0; i < 10; i++)
        {
            if (i >= limit)
            {
                yield break;
            }

            yield return i;
        }
    }

    // Multiple yields on multiple paths, and a yield inside every loop form.
    public IEnumerable<int> ManyPaths(int mode, IEnumerable<int> source)
    {
        if (mode == 0)
        {
            yield return 0;
        }
        else if (mode == 1)
        {
            yield return 1;
            yield return 2;
        }

        foreach (int item in source)
        {
            yield return item;
        }

        for (int i = 0; i < 2; i++)
        {
            yield return i;
        }

        int j = 0;
        while (j < 2)
        {
            yield return j++;
        }

        do
        {
            yield return j++;
        }
        while (j < 5);

        switch (mode)
        {
            case 9:
                yield return 9;
                break;

            default:
                yield return -1;
                break;
        }
    }

    // `yield` inside try/FINALLY: legal, and the finally runs on disposal of
    // the enumerator, which may be long after the last MoveNext.
    public IEnumerable<int> WithTryFinally()
    {
        try
        {
            yield return 1;
            yield return 2;
        }
        finally
        {
            Console.WriteLine("disposed");
        }
    }

    // `yield` inside a nested try/finally, and a try/CATCH that contains no
    // yield — because a yield inside a catch is illegal.
    public IEnumerable<int> WithCatchAround(IEnumerable<string> source)
    {
        foreach (string raw in source)
        {
            int parsed;
            try
            {
                parsed = int.Parse(raw);
            }
            catch (FormatException)
            {
                continue;
            }

            yield return parsed;
        }
    }

    // THE TWO-METHOD SPLIT. An iterator's body does not run until enumeration,
    // so eager validation must live in a NON-iterator wrapper that returns the
    // iterator. The public method has no yield; the private one does. An
    // extractor that only looks at the public surface sees no iterator at all.
    public IEnumerable<int> Validated(IEnumerable<int>? source, int take)
    {
        if (source is null)
        {
            throw new ArgumentNullException(nameof(source));
        }

        if (take < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(take));
        }

        return ValidatedIterator(source, take);
    }

    private static IEnumerable<int> ValidatedIterator(IEnumerable<int> source, int take)
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

    // A generic iterator, an iterator on an interface implementation, and an
    // iterator as a LOCAL FUNCTION.
    public IEnumerable<T> Generic<T>(IEnumerable<T> source, Func<T, bool> predicate)
    {
        foreach (T item in source)
        {
            if (predicate(item))
            {
                yield return item;
            }
        }
    }

    public int LocalFunctionIterator(int limit)
    {
        int total = 0;
        foreach (int value in Inner())
        {
            total += value;
        }

        return total;

        IEnumerable<int> Inner()
        {
            for (int i = 0; i < limit; i++)
            {
                yield return i;
            }
        }
    }

    // An iterator PROPERTY and an iterator INDEXER — accessors may be
    // iterators too, which is a member kind an extractor keyed on methods
    // misses entirely.
    public IEnumerable<int> IteratorProperty
    {
        get
        {
            yield return 1;
            yield return 2;
        }
    }

    public IEnumerable<int> this[int start]
    {
        get
        {
            for (int i = start; i < start + 2; i++)
            {
                yield return i;
            }
        }
    }

    // An iterator whose element type is itself an iterator's result — nested
    // laziness, where nothing runs until the outermost MoveNext.
    public IEnumerable<IEnumerable<int>> Nested(int count)
    {
        for (int i = 0; i < count; i++)
        {
            yield return Inner(i);
        }

        IEnumerable<int> Inner(int seed)
        {
            yield return seed;
            yield return seed * 2;
        }
    }
}

// A type made foreach-able by implementing the enumerator PATTERN rather than
// the interface: `foreach` needs only a public GetEnumerator with Current and
// MoveNext, and neither IEnumerable nor IEnumerator need be mentioned.
public class DuckTypedEnumerable
{
    private readonly int[] items = { 1, 2, 3 };

    public Enumerator GetEnumerator() => new Enumerator(items);

    public struct Enumerator
    {
        private readonly int[] items;
        private int index;

        public Enumerator(int[] items)
        {
            this.items = items;
            index = -1;
        }

        public int Current => items[index];

        public bool MoveNext() => ++index < items.Length;
    }
}

// The enumerator pattern satisfied by an EXTENSION METHOD (C# 9): `foreach`
// over a type that has no GetEnumerator at all.
public static class DuckTypedExtensions
{
    public static IEnumerator<char> GetEnumerator(this System.Text.StringBuilder builder)
    {
        for (int i = 0; i < builder.Length; i++)
        {
            yield return builder[i];
        }
    }
}

public class IteratorConsumers
{
    public int Consume(Iterators source)
    {
        int total = 0;

        foreach (int value in source.AsEnumerable())
        {
            total += value;
        }

        foreach (int value in source.IteratorProperty)
        {
            total += value;
        }

        foreach (int value in source[5])
        {
            total += value;
        }

        foreach (var inner in source.Nested(2))
        {
            foreach (int value in inner)
            {
                total += value;
            }
        }

        // Manual enumeration, which is what foreach compiles to.
        using (IEnumerator<int> enumerator = source.AsEnumerable().GetEnumerator())
        {
            while (enumerator.MoveNext())
            {
                total += enumerator.Current;
            }
        }

        // Duck-typed foreach, over a type implementing no interface.
        foreach (int value in new DuckTypedEnumerable())
        {
            total += value;
        }

        // Extension-method foreach: the GetEnumerator is not a member of
        // StringBuilder at all.
        foreach (char c in new System.Text.StringBuilder("abc"))
        {
            total += c;
        }

        return total;
    }
}
