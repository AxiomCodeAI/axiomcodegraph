// HALF TWO — async/await, including IAsyncEnumerable.
//
// An `async` method's body is rewritten into a state machine, so every `await`
// is a suspension point and the code after it may run on a different thread.
// The parser sees none of that; what it must not lose is that `await X()` is a
// call to X plus an await, that the method's declared return type is
// Task/ValueTask/void/IAsyncEnumerable, and that `await foreach` and
// `await using` are their own constructs.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

namespace Fixtures.CSharpOnly.AsyncIterators;

public class AsyncForms
{
    // Every legal async return type.
    public async Task NoResult() => await Task.Yield();

    public async Task<int> WithResult()
    {
        await Task.Delay(1);
        return 1;
    }

    public async ValueTask NoResultValue() => await Task.Yield();

    public async ValueTask<int> WithResultValue()
    {
        await Task.Delay(1);
        return 1;
    }

    // `async void` — fire and forget, uncatchable exceptions, and the reason
    // event handlers are the only place it belongs.
    public async void FireAndForget()
    {
        await Task.Delay(1);
    }

    // An async method with NO await: legal, warns CS1998, and runs
    // synchronously. The state machine is still generated.
    public async Task<int> NoAwait()
    {
        return 1;
    }

    // Awaiting in every position an expression may occupy.
    public async Task<int> AwaitPositions(CancellationToken cancellationToken)
    {
        // Statement position.
        await Task.Delay(1, cancellationToken);

        // Initialiser.
        int a = await WithResult();

        // Argument.
        Consume(await WithResult());

        // Binary operand, on both sides.
        int b = await WithResult() + await WithResult();

        // Ternary condition and arms.
        int c = await WithResult() > 0 ? await WithResult() : 0;

        // Receiver of a member access and of a call.
        int d = (await GetListAsync()).Count;
        int e = (await GetListAsync()).Find(x => x > 0);

        // Inside an interpolation.
        string f = $"{await WithResult()}";

        // Inside a collection initialiser and a lambda body.
        var g = new List<int> { await WithResult() };
        Func<Task<int>> h = async () => await WithResult();

        // `await` on a ConfiguredTaskAwaitable, which is a different awaited
        // TYPE for the same call.
        int i = await WithResult().ConfigureAwait(false);

        // `await` on something that is not a Task at all — anything with a
        // GetAwaiter method. `Task.Yield()` returns a YieldAwaitable.
        await Task.Yield();

        // `await` on a ValueTask, and on a custom awaitable.
        int j = await WithResultValue();
        int k = await new CustomAwaitable(7);

        // Chained awaits.
        int l = await (await GetTaskOfTaskAsync());

        return a + b + c + d + e + f.Length + g.Count + await h() + i + j + k + l;
    }

    // await inside try/catch/finally, using, lock-free critical sections, and
    // loops — the places the rewriter has to be careful and a parser has to
    // keep the structure.
    public async Task<int> AwaitInStructures(IEnumerable<int> source, CancellationToken token)
    {
        int total = 0;

        try
        {
            total += await WithResult();
        }
        catch (OperationCanceledException)
        {
            total = -1;
        }
        catch (Exception e) when (ShouldHandle(e).GetAwaiter().GetResult())
        {
            // `await` is ILLEGAL inside an exception filter (CS7094), so real
            // code that wants an async predicate here blocks on it instead.
            // Recorded rather than simulated: there is no awaiting filter.
            total = -2;
        }
        finally
        {
            await Task.Yield();
        }

        foreach (int item in source)
        {
            total += await Identity(item);
        }

        for (int i = 0; i < 3; i++)
        {
            total += await Identity(i);
        }

        while (total < 10)
        {
            total += await Identity(1);
        }

        do
        {
            total += await Identity(1);
        }
        while (total < 20);

        using (var reader = new StringReader("x"))
        {
            total += (await reader.ReadToEndAsync()).Length;
        }

        // `await using` — the async disposal form, statement and declaration.
        await using (var resource = new AsyncResource())
        {
            total += resource.Value;
        }

        await using var declared = new AsyncResource();
        total += declared.Value;

        // A switch expression with an awaited arm.
        total += total switch
        {
            > 100 => await Identity(1),
            _ => 0
        };

        return total;
    }

    // Task combinators — the shape where several call edges become one await.
    public async Task<int> Combinators()
    {
        Task<int> first = WithResult();
        Task<int> second = WithResult();

        int[] all = await Task.WhenAll(first, second);
        Task<int> winner = await Task.WhenAny(first, second);
        int fromWinner = await winner;

        await Task.WhenAll(NoResult(), NoResult());

        // Starting a task without awaiting it: the call edge exists and the
        // await does not.
        Task notAwaited = NoResult();
        _ = notAwaited;

        // `Task.Run` with a lambda body, where the lambda is the thing that
        // runs and its calls belong to it.
        int fromRun = await Task.Run(() => WithResult());
        int fromRunAsync = await Task.Run(async () => await WithResult());

        return all.Length + fromWinner + fromRun + fromRunAsync;
    }

    // IAsyncEnumerable: an async ITERATOR. Both `async` and `yield return` in
    // one method, which no other construct combines.
    public async IAsyncEnumerable<int> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        for (int i = 0; i < 3; i++)
        {
            await Task.Delay(1, cancellationToken);
            yield return i;
        }

        yield break;
    }

    public async IAsyncEnumerable<string> StreamWithTryFinally()
    {
        try
        {
            for (int i = 0; i < 2; i++)
            {
                await Task.Yield();
                yield return i.ToString();
            }
        }
        finally
        {
            await Task.Yield();
        }
    }

    // `await foreach`, in all three forms.
    public async Task<int> ConsumeStream(CancellationToken token)
    {
        int total = 0;

        await foreach (int value in StreamAsync(token))
        {
            total += value;
        }

        // With ConfigureAwait, which changes the awaited type.
        await foreach (int value in StreamAsync(token).ConfigureAwait(false))
        {
            total += value;
        }

        // With WithCancellation, which flows the token into the
        // [EnumeratorCancellation] parameter — a dataflow edge expressed as an
        // attribute.
        await foreach (int value in StreamAsync().WithCancellation(token))
        {
            total += value;
        }

        // Over a deconstructing element.
        await foreach (var (a, b) in PairsAsync())
        {
            total += a + b;
        }

        return total;
    }

    private async IAsyncEnumerable<(int A, int B)> PairsAsync()
    {
        await Task.Yield();
        yield return (1, 2);
    }

    private static void Consume(int value)
    {
    }

    private static async Task<int> Identity(int value)
    {
        await Task.Yield();
        return value;
    }

    private static async Task<bool> ShouldHandle(Exception e)
    {
        await Task.Yield();
        return e is InvalidOperationException;
    }

    private static async Task<List<int>> GetListAsync()
    {
        await Task.Yield();
        return new List<int> { 1 };
    }

    private static async Task<Task<int>> GetTaskOfTaskAsync()
    {
        await Task.Yield();
        return Task.FromResult(1);
    }
}

// A CUSTOM AWAITABLE: `await x` needs only a GetAwaiter() returning something
// with IsCompleted, OnCompleted and GetResult. None of those names appears at
// the await site.
public readonly struct CustomAwaitable
{
    private readonly int value;

    public CustomAwaitable(int value) => this.value = value;

    public CustomAwaiter GetAwaiter() => new CustomAwaiter(value);
}

public readonly struct CustomAwaiter : INotifyCompletion
{
    private readonly int value;

    public CustomAwaiter(int value) => this.value = value;

    public bool IsCompleted => true;

    public void OnCompleted(Action continuation) => continuation();

    public int GetResult() => value;
}

// An awaitable made so by an EXTENSION METHOD — `await 5;` compiles if
// GetAwaiter is an extension in scope. The await site names neither the
// extension nor its class.
public static class AwaitableExtensions
{
    public static CustomAwaiter GetAwaiter(this int value) => new CustomAwaiter(value);
}

public sealed class AsyncResource : IAsyncDisposable, IDisposable
{
    public int Value => 1;

    public ValueTask DisposeAsync() => default;

    public void Dispose()
    {
    }
}
