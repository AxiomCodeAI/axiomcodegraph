// ============================================================================
// THE TRACER. Compiled INTO the instrumented mirror, so it has no dependencies
// and cannot be the reason a subject fails to build.
//
// WHAT IT RECORDS: for every method entry, the (caller, callee) pair, where the
// caller is the entry below it on this thread's shadow stack. That is an exact
// caller/callee edge and it needs no per-call-site rewriting to obtain.
//
// IT MAKES NO ASSUMPTION ABOUT THE SUBJECT'S COMPILER SETTINGS, and that is not a
// style preference. Measured: written with `using System;` and nullable
// annotations, it failed to build inside FluentValidation with five errors --
// CS0246 for ThreadStaticAttribute and CS8632 for `?` -- because that project sets
// neither ImplicitUsings nor a nullable context. A file injected into an arbitrary
// project cannot rely on either, so every name here is `global::`-qualified, no
// nullable annotation appears, and no `using` is needed.
//
// FOUR CONSTRAINTS THAT SHAPED THE REST:
//
//  1. IT MUST NOT CHANGE WHAT THE SUBJECT DOES. No exception escapes, ever: a probe
//     that threw inside a `catch` filter or a static initializer would change
//     control flow and the trace would be of a different program. Every path is
//     wrapped and failures are counted, not raised.
//
//  2. IT MUST SURVIVE THE TEST RUNNER. A test host may be killed rather than
//     exited, and several hosts run in parallel processes. So the output is
//     APPEND-ONLY, one file per process, flushed on a count as well as at exit --
//     not one file written at the end, which is how a trace comes back empty after
//     a green test run.
//
//  3. NO ALLOCATION ON THE HOT PATH beyond the counter itself. A suite that takes
//     two minutes untraced is not usable evidence if tracing makes it twenty.
//
//  4. THE SHADOW STACK MUST TOLERATE AN UNBALANCED ENTRY. There is no exit probe:
//     adding one means wrapping every body in try/finally, which changes exception
//     semantics. So the stack is a fixed-size per-thread array and the caller is
//     read from its top, which is approximate in one specific way that the join
//     states: a method that returns, followed by a sibling call, attributes that
//     sibling to the returned-from method rather than to their common parent.
// ============================================================================

// PUBLIC, not internal. Some projects compile library sources into their test
// assembly as well (a shared-source include, or a test that needs an internal
// type), so an instrumented file can end up in more than one assembly. An
// `internal` tracer is then invisible from the second one and the build fails with
// CS0122 on every probe -- measured on FluentValidation, whose test project
// compiles src/FluentValidation/Internal/*.cs directly.
//
// The same instrumented file landing in two assemblies is harmless for the trace:
// the ids are identical, so the edges merge.
public static class AxiomCsTrace
{
    private const int StackDepth = 512;

    [global::System.ThreadStatic] private static int[] _stack;
    [global::System.ThreadStatic] private static int _sp;

    // (caller << 32 | callee) -> count. One dictionary, so a trace of tens of
    // millions of entries stays a few megabytes.
    private static readonly global::System.Collections.Concurrent.ConcurrentDictionary<long, long> Edges =
        new global::System.Collections.Concurrent.ConcurrentDictionary<long, long>();
    private static readonly global::System.Collections.Concurrent.ConcurrentDictionary<int, long> Entries =
        new global::System.Collections.Concurrent.ConcurrentDictionary<int, long>();

    private static long _probeFailures;
    private static long _stackOverflows;
    private static long _sinceFlush;
    private static readonly string OutPath;
    private static readonly object FlushLock = new object();

    static AxiomCsTrace()
    {
        string dir = global::System.Environment.GetEnvironmentVariable("AXIOM_CS_TRACE_OUT");
        if (dir == null || dir.Length == 0)
        {
            dir = global::System.IO.Path.Combine(global::System.IO.Path.GetTempPath(), "axiom-cs-trace");
        }
        try { global::System.IO.Directory.CreateDirectory(dir); } catch { }
        OutPath = global::System.IO.Path.Combine(
            dir,
            "trace-" + global::System.Diagnostics.Process.GetCurrentProcess().Id.ToString() +
            "-" + global::System.Guid.NewGuid().ToString("N") + ".tsv");
        try
        {
            global::System.AppDomain.CurrentDomain.ProcessExit += delegate { Flush(); };
            global::System.AppDomain.CurrentDomain.DomainUnload += delegate { Flush(); };
            global::System.AppDomain.CurrentDomain.UnhandledException += delegate { Flush(); };
        }
        catch { }
    }

    /// <summary>Method entry. The only probe the instrumenter injects.</summary>
    public static void E(int id)
    {
        try
        {
            int[] st = _stack;
            if (st == null) { st = new int[StackDepth]; _stack = st; }
            int caller = _sp > 0 ? st[_sp - 1] : -1;
            if (_sp < StackDepth) { st[_sp] = id; }
            else { global::System.Threading.Interlocked.Increment(ref _stackOverflows); }
            // INCREMENTED EVEN PAST THE CAP, so the matching X() still balances: if the
            // depth were clamped, every pop beyond the cap would remove a frame that is
            // still live and the caller would be wrong for the rest of the thread.
            _sp = _sp + 1;

            Entries.AddOrUpdate(id, 1L, AddOne);
            long key = ((long)(uint)caller << 32) | (uint)id;
            Edges.AddOrUpdate(key, 1L, AddOneL);

            // Flush on a count rather than on a timer: a timer thread is another way
            // to change the subject's behaviour, and a count is deterministic.
            if (global::System.Threading.Interlocked.Increment(ref _sinceFlush) >= 2000000) Flush();
        }
        catch { global::System.Threading.Interlocked.Increment(ref _probeFailures); }
    }

    /// <summary>
    /// Method exit, from the `finally` the instrumenter wraps each body in. Pairs
    /// with E; without it the shadow stack only grows and the caller read off its top
    /// is meaningless past the cap.
    /// </summary>
    public static void X()
    {
        try
        {
            if (_sp > 0) _sp = _sp - 1;
        }
        catch { global::System.Threading.Interlocked.Increment(ref _probeFailures); }
    }

    private static long AddOne(int k, long v) { return v + 1; }
    private static long AddOneL(long k, long v) { return v + 1; }

    private static void Flush()
    {
        lock (FlushLock)
        {
            try
            {
                global::System.Text.StringBuilder sb = new global::System.Text.StringBuilder();
                foreach (global::System.Collections.Generic.KeyValuePair<long, long> kv in Edges)
                {
                    int caller = (int)(kv.Key >> 32);
                    int callee = (int)(uint)kv.Key;
                    sb.Append("E\t").Append(caller).Append('\t').Append(callee)
                      .Append('\t').Append(kv.Value).Append('\n');
                }
                foreach (global::System.Collections.Generic.KeyValuePair<int, long> kv in Entries)
                {
                    sb.Append("N\t").Append(kv.Key).Append('\t').Append(kv.Value).Append('\n');
                }
                sb.Append("M\tprobeFailures\t")
                  .Append(global::System.Threading.Interlocked.Read(ref _probeFailures)).Append('\n');
                sb.Append("M\tstackOverflows\t")
                  .Append(global::System.Threading.Interlocked.Read(ref _stackOverflows)).Append('\n');
                global::System.IO.File.AppendAllText(OutPath, sb.ToString());
                Edges.Clear();
                Entries.Clear();
                global::System.Threading.Interlocked.Exchange(ref _sinceFlush, 0);
            }
            catch { /* a trace that cannot be written must not fail the suite */ }
        }
    }
}
