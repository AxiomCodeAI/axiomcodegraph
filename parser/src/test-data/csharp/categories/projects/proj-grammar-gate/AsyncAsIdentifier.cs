// GATE FIXTURE for cs-impl — `async` AS AN ORDINARY IDENTIFIER.
//
// `async` is a CONTEXTUAL keyword. It is a modifier in front of a method,
// lambda or anonymous method, and an ordinary identifier everywhere else: a
// local, a parameter, a field, a property, a type name, a namespace segment, a
// named argument, a label. All of it below is legal C# 1.0-onwards and the
// compiler accepts every line.
//
// The vendored grammar does NOT, unpatched. `async` was only in `modifier` and
// not in `_reserved_identifier`, so an occurrence in expression position is an
// ERROR NODE that truncates the remainder of the file.
//
// TWO HALVES, AND BOTH ARE THE GATE:
//   * Part 1 uses `async` as an identifier. Unpatched, these error.
//   * Part 2 uses `async` as a modifier, in every position it is legal.
//     The patch adds `async` to `_reserved_identifier` plus two LR conflicts,
//     and a patch that broke the modifier reading would still make Part 1 pass.
//     Part 2 is the control that catches it.
//
// The first declaration in the file is deliberately ORDINARY, and the last
// declaration is deliberately AFTER all the awkward ones, so a truncating
// parser shows the characteristic signature: the head recovered, the tail gone.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Fixtures.GrammarGate;

/// <summary>Ordinary. Recovered even by a truncating parser; that is the point.</summary>
public sealed class BeforeAnyAsync
{
    public int Value => 1;

    public string Describe() => "before";
}

// ---------------------------------------------------------------------------
// PART 1 — `async` as an ORDINARY IDENTIFIER.
// ---------------------------------------------------------------------------

public class AsyncAsIdentifier
{
    // As a FIELD name, including one initialised from another expression.
    private bool async;

    private int asyncCount;

    private static readonly bool AsyncFlag = true;

    // As a PROPERTY name.
    public bool IsAsync { get; set; }

    // As a PARAMETER name — the `F(q, async: true)` case from the measurement.
    public int Configure(int queue, bool async, bool sync = false) =>
        queue + (async ? 1 : 0) + (sync ? 1 : 0);

    // As a LOCAL, in every expression position the measurement named.
    public int EveryPosition(bool flag)
    {
        // `var x = async` — a plain read.
        bool async = flag;
        var copied = async;

        // `if (async)` — a condition.
        if (async)
        {
            asyncCount++;
        }

        while (async)
        {
            async = false;
        }

        do
        {
            asyncCount++;
        }
        while (async);

        // `async ? a : b` — a ternary condition.
        int chosen = async ? 1 : 2;

        // As an operand on both sides.
        bool combined = async && !async;
        bool compared = async == copied;
        bool negated = !async;

        // As an ARGUMENT, positional and named.
        int configured = Configure(1, async);
        int named = Configure(queue: 1, async: true);
        int namedOutOfOrder = Configure(async: false, queue: 2);

        // As an assignment target, including compound and null-coalescing.
        async = true;
        async |= false;
        async &= true;

        bool? maybeAsync = null;
        maybeAsync ??= async;

        // As a member-access receiver and as a member name.
        this.async = async;
        bool viaThis = this.async;

        // In an interpolation and in a collection initialiser.
        string text = $"{async}/{chosen}";
        var list = new List<bool> { async, copied };

        // In a lambda BODY, where the enclosing lambda is not async.
        Func<bool> read = () => async;
        Func<bool, bool> project = a => a && async;

        // In a switch expression arm and a pattern.
        string described = async switch
        {
            true => "yes",
            false => "no",
        };

        bool matched = async is true;

        // As a `foreach` variable.
        foreach (bool async2 in list)
        {
            asyncCount += async2 ? 1 : 0;
        }

        // As an `out` variable and in a deconstruction.
        TryRead(out bool asyncOut);
        (bool asyncA, bool asyncB) = (true, false);

        return chosen + configured + named + namedOutOfOrder + (viaThis ? 1 : 0)
            + text.Length + list.Count + (read() ? 1 : 0) + (project(true) ? 1 : 0)
            + described.Length + (matched ? 1 : 0) + (combined ? 1 : 0)
            + (compared ? 1 : 0) + (negated ? 1 : 0) + (asyncOut ? 1 : 0)
            + (asyncA ? 1 : 0) + (asyncB ? 1 : 0) + (maybeAsync == true ? 1 : 0)
            + (AsyncFlag ? 1 : 0) + (IsAsync ? 1 : 0);
    }

    private static bool TryRead(out bool async)
    {
        async = true;
        return true;
    }

    // As a LABEL and a `goto` target.
    public int AsLabel(bool flag)
    {
        if (flag)
        {
            goto async;
        }

        return 0;

    async:
        return 1;
    }

    // As a METHOD name, and called.
    public int Async(int value) => value;

    public int CallsIt() => Async(1) + this.Async(2);

    // As a LOCAL FUNCTION name.
    public int LocalNamedAsync()
    {
        int async(int x) => x + 1;
        return async(1);
    }

    // `await` used as an identifier too — it is contextual in exactly the same
    // way, and only reserved inside an async method.
    public int AwaitAsIdentifier()
    {
        int await = 1;
        int result = await + 1;
        return result;
    }
}

// As a TYPE name, a NAMESPACE segment, a type PARAMETER and an ENUM member.
public class async
{
    public int Value => 1;
}

public struct Async
{
    public int Value;
}

public enum AsyncMode
{
    async,
    await,
    var,
    dynamic,
    record,
    nint,
}

public class GenericNamedAsync<async>
{
    public async Value { get; set; }
}

// `async` is also legal as a NAMESPACE segment, but not in this file: a block
// namespace cannot sit beside the file-scoped one (CS8955), and `namespace
// async.Nested` would collide with the `class async` above (CS0101). It is
// covered instead in AsyncAsNamespace.cs, which has its own file precisely so
// the two readings are in separate compilation units.

// The other contextual keywords, in the same shape, because a patch that
// special-cases `async` alone leaves the class of defect open. Each of these is
// a legal identifier.
public class OtherContextualKeywords
{
    public int var;
    public int dynamic;
    public int record;
    public int nameof;
    public int value;
    public int partial;
    public int where;
    public int from;
    public int select;
    public int join;
    public int global;
    public int required;
    public int scoped;
    public int file;
    public int managed;
    public int args;

    public int Sum()
    {
        int var = 1;
        int dynamic = 2;
        int record = 3;
        int from = 4;
        int select = 5;
        int where = 6;
        int value = 7;
        int nameof = 8;
        int partial = 9;
        int global = 10;

        // `from` and `select` as identifiers, in a file that also contains a
        // real LINQ query below — the two readings side by side.
        return var + dynamic + record + from + select + where + value + nameof
            + partial + global;
    }

    public IEnumerable<int> RealQuery(IEnumerable<int> source) =>
        from item in source
        where item > 0
        select item;
}

// ---------------------------------------------------------------------------
// PART 2 — `async` as a MODIFIER. THE CONTROL.
// A patch that broke this while fixing Part 1 would still pass a Part-1-only
// gate.
// ---------------------------------------------------------------------------

public class AsyncAsModifier
{
    public async Task NoResult() => await Task.Yield();

    public async Task<int> WithResult()
    {
        await Task.Delay(1);
        return 1;
    }

    public async ValueTask<int> ValueResult() => await WithResult();

    public static async Task StaticAsync() => await Task.Yield();

    public virtual async Task VirtualAsync() => await Task.Yield();

    protected internal async Task ManyModifiers() => await Task.Yield();

    public async void FireAndForget() => await Task.Yield();

    public async IAsyncEnumerable<int> Stream()
    {
        await Task.Yield();
        yield return 1;
    }

    public void EveryLambdaForm()
    {
        Func<Task> bare = async () => await Task.Yield();
        Func<int, Task<int>> oneParam = async x => await Task.FromResult(x);
        Func<int, Task<int>> typedParam = async (int x) => await Task.FromResult(x);
        Func<int, int, Task<int>> twoParams = async (a, b) => await Task.FromResult(a + b);
        Func<Task> anonymous = async delegate { await Task.Yield(); };
        Func<int, Task<int>> statik = static async x => await Task.FromResult(x);

        async Task LocalFunction() => await Task.Yield();

        static async Task StaticLocalFunction() => await Task.Yield();

        _ = bare; _ = oneParam; _ = typedParam; _ = twoParams;
        _ = anonymous; _ = statik; _ = LocalFunction(); _ = StaticLocalFunction();
    }

    // A method that is `async` AND has a parameter named `async` -- the two
    // readings of the same token, four characters apart.
    public async Task<int> BothAtOnce(bool async)
    {
        await Task.Yield();
        return async ? 1 : 0;
    }

    // An async lambda whose parameter is named `async`.
    public Func<bool, Task<int>> BothInALambda =
        async async => await Task.FromResult(async ? 1 : 0);
}

// ---------------------------------------------------------------------------
// The LAST declaration. A truncating parser loses this and keeps
// `BeforeAnyAsync` at the top -- the characteristic signature, and the reason
// both bookends exist.
// ---------------------------------------------------------------------------

/// <summary>Declared after every awkward construct in the file.</summary>
public sealed record AfterAllAsync(int Id, string Name)
{
    public string Describe() => $"{Id}:{Name}";
}
