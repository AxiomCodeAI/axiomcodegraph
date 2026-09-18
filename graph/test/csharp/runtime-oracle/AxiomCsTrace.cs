// ============================================================================
// THE TRACER. Compiled INTO the instrumented mirror, so it has no dependencies
// and cannot be the reason a subject fails to build.
//
// WHAT IT RECORDS: for every method entry, the (caller, callee) pair, where the
// caller is the entry below it on this thread's shadow stack. That is an exact
// caller/callee edge and it needs no per-call-site rewriting to obtain.
//
// FOUR CONSTRAINTS THAT SHAPED IT:
//
//  1. IT MUST NOT CHANGE WHAT THE SUBJECT DOES. No exceptions escape, ever: a probe
//     that throws inside a `catch` filter or a static initializer would change
//     control flow and the trace would be of a different program. Every path is
//     wrapped and failures are counted, not raised.
//
//  2. IT MUST SURVIVE THE TEST RUNNER. A test host may be killed rather than
//     exited, and several hosts run in parallel processes. So the output is
//     APPEND-ONLY, one file per process, flushed periodically as well as at exit --
//     not a single file written once at the end, which is how a trace comes back
//     empty after a green test run.
//
//  3. NO ALLOCATION ON THE HOT PATH beyond the counter itself. A subject whose test
//     suite takes two minutes untraced is not usable evidence if tracing makes it
//     twenty.
//
//  4. THE SHADOW STACK MUST TOLERATE AN UNBALANCED ENTRY. There is no exit probe:
//     adding one would mean wrapping every body in try/finally, which changes
//     exception semantics around `ref` locals and stackalloc. Instead the stack is a
//     FIXED-SIZE RING of the last N entries per thread and the caller is read from
//     it, which is approximate in one specific way that is stated in the join: a
//     method that returns and is then followed by a sibling call attributes that
//     sibling to the returned-from method rather than to their common parent.
//     The join reports both readings rather than choosing.
// ============================================================================

using System.Collections.Concurrent;
using System.Text;

internal static class AxiomCsTrace
{
    private const int StackDepth = 512;

    [ThreadStatic] private static int[]? _stack;
    [ThreadStatic] private static int _sp;

    // (caller << 20 | callee) -> count. One dictionary, one boxed long key, so a
    // trace of tens of millions of entries stays a few megabytes.
    private static readonly ConcurrentDictionary<long, long> Edges = new();
    private static readonly ConcurrentDictionary<int, long> Entries = new();
    private static long _probeFailures;
    private static long _stackOverflows;
    private static readonly string OutPath;
    private static readonly object FlushLock = new();
    private static long _sinceFlush;

    static AxiomCsTrace()
    {
        var dir = Environment.GetEnvironmentVariable("AXIOM_CS_TRACE_OUT");
        if (string.IsNullOrEmpty(dir)) dir = Path.Combine(Path.GetTempPath(), "axiom-cs-trace");
        try { Directory.CreateDirectory(dir); } catch { }
        OutPath = Path.Combine(dir, $"trace-{Environment.ProcessId}-{Guid.NewGuid():N}.tsv");
        // Both hooks: ProcessExit for a clean shutdown, and the unload handler for a
        // host that tears the domain down instead.
        try
        {
            AppDomain.CurrentDomain.ProcessExit += (_, _) => Flush();
            AppDomain.CurrentDomain.DomainUnload += (_, _) => Flush();
            AppDomain.CurrentDomain.UnhandledException += (_, _) => Flush();
        }
        catch { }
    }

    /// <summary>Method entry. The only probe the instrumenter injects.</summary>
    public static void E(int id)
    {
        try
        {
            var st = _stack ??= new int[StackDepth];
            var caller = _sp > 0 ? st[_sp - 1] : -1;
            if (_sp < StackDepth) st[_sp++] = id;
            else Interlocked.Increment(ref _stackOverflows);

            Entries.AddOrUpdate(id, 1, static (_, v) => v + 1);
            var key = ((long)(uint)caller << 32) | (uint)id;
            Edges.AddOrUpdate(key, 1, static (_, v) => v + 1);

            // Flush on a count rather than on a timer: a timer thread is another way
            // to change the subject's behaviour, and a count is deterministic.
            if (Interlocked.Increment(ref _sinceFlush) >= 2_000_000) Flush();
        }
        catch { Interlocked.Increment(ref _probeFailures); }
    }

    private static void Flush()
    {
        lock (FlushLock)
        {
            try
            {
                var sb = new StringBuilder();
                foreach (var kv in Edges)
                {
                    var caller = (int)(kv.Key >> 32);
                    var callee = (int)(uint)kv.Key;
                    sb.Append("E\t").Append(caller).Append('\t').Append(callee)
                      .Append('\t').Append(kv.Value).Append('\n');
                }
                foreach (var kv in Entries)
                    sb.Append("N\t").Append(kv.Key).Append('\t').Append(kv.Value).Append('\n');
                sb.Append("M\tprobeFailures\t").Append(Interlocked.Read(ref _probeFailures)).Append('\n');
                sb.Append("M\tstackOverflows\t").Append(Interlocked.Read(ref _stackOverflows)).Append('\n');
                File.AppendAllText(OutPath, sb.ToString(), new UTF8Encoding(false));
                Edges.Clear();
                Entries.Clear();
                Interlocked.Exchange(ref _sinceFlush, 0);
            }
            catch { /* a trace that cannot be written must not fail the suite */ }
        }
    }
}
