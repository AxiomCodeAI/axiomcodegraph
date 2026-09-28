#!/usr/bin/env python3
"""tests/query_rules.py: the query rules are compiled once per MACHINE, never while a query waits (#1606).

The query programs (dl/impact.dl, dl/path*.dl) are compiled to native binaries keyed by their rules. They were kept in
the plugin's own dl/.cache, so every plugin copy (an update, a second checkout, a worktree) recompiled identical rules,
and the first query after a build could pay the whole compile (44 s for impact.dl on a C# library). Checked here on a
tiny program in throwaway plugin copies, with the user cache pointed at a temporary XDG_CACHE_HOME:

  - a query with nothing compiled answers at once, from the interpreter, and starts ONE background compile
  - the binary lands in the user cache, not in the plugin; a second plugin copy with the same rules reuses it
  - control: a copy whose rules differ by one line does not
  - a binary an older plugin left in dl/.cache is still used
  - three queries at once all answer, and leave one binary and no lock, .cpp or .tmp behind
  - the interpreter and the binary derive the same rows
  - warm() (what `axiomcode index` calls) reports every program compiled

    python3 tests/query_rules.py [-v]

Needs soufflé and a C++ compiler; without them it says so and passes nothing.
"""
import os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
RULES = '.decl e(a:number, b:number)\n.input e\n.decl r(a:number, b:number)\n.output r\nr(a, b) :- e(a, b).\nr(a, c) :- r(a, b), e(b, c).\n'
RULES_OTHER = RULES + 'r(a, a) :- e(a, _).\n'
fails = []
passed = 0
verbose = '-v' in sys.argv


def check(ok, what, detail=''):
    global passed
    if ok: passed += 1
    else: fails.append(what)
    print(('  ok    ' if ok else '  FAIL  ') + what + ('' if ok or not detail else '\n        ' + str(detail)[:600].replace('\n', '\n        ')))


def plugin(work, name, rules=RULES):
    d = os.path.join(work, name, 'scripts'); os.makedirs(os.path.join(d, 'dl'))
    shutil.copy(os.path.join(SCRIPTS, 'dl_program.py'), d)
    with open(os.path.join(d, 'dl', 'q.dl'), 'w') as fh: fh.write(rules)
    return d


def py(scripts, code, env):
    t = time.time()
    r = subprocess.run([sys.executable, '-c', 'import sys; sys.path.insert(0, sys.argv[1]); import dl_program as d\n' + code, scripts],
                       capture_output=True, text=True, env=env, timeout=300)
    return r.stdout.strip(), r.stderr, time.time() - t


def wait_for(pred, secs=240):
    end = time.time() + secs
    while time.time() < end:
        if pred(): return True
        time.sleep(0.5)
    return False


def main():
    if not (shutil.which('souffle') and shutil.which('c++')):
        print('soufflé or c++ missing: nothing to check'); return 0
    work = tempfile.mkdtemp(prefix='ax-query-rules-')
    try:
        env = dict(os.environ, XDG_CACHE_HOME=os.path.join(work, 'xdg')); env.pop('AXIOMCODE_QUERY_CACHE', None); env.pop('AXIOMCODE_INTERPRET', None)
        qdir = os.path.join(work, 'xdg', 'axiomcode', 'queries')
        a = plugin(work, 'copy-a')

        # 1. nothing compiled: the interpreter at once, a compile in the background
        out, err, took = py(a, "print(' '.join(d.program('q.dl')))", env)
        check(out.startswith('souffle ') and took < 10, f'a first query answers from the interpreter at once ({took:.1f}s)', out + err)
        check('compiling to a native binary in the background' in err, 'and says the rules are compiling in the background', err)
        done = wait_for(lambda: any(n.startswith('q-') and not n.endswith(('.lock', '.nocompile', '.cpp', '.tmp')) for n in os.listdir(qdir)) if os.path.isdir(qdir) else False)
        check(done, 'the background compile finishes into the user cache', os.listdir(qdir) if os.path.isdir(qdir) else 'no cache dir')
        check(not os.path.exists(os.path.join(a, 'dl', '.cache')), 'nothing is written inside the plugin (dl/.cache)')
        wait_for(lambda: not any(n.endswith('.lock') for n in os.listdir(qdir)), 30)
        binp, _, _ = py(a, "print(d.program('q.dl')[0])", env)
        check(binp.startswith(qdir) and os.access(binp, os.X_OK), 'the next query runs the compiled binary', binp)

        # 2. another plugin copy with the same rules: no compile
        b = plugin(work, 'copy-b')
        out, err, took = py(b, "print(d.program('q.dl')[0])", env)
        check(out == binp and 'compiling' not in err, f'a second plugin copy with the same rules reuses that binary ({took:.1f}s)', out + err)
        # control: rules one line apart are not the same program
        c = plugin(work, 'copy-c', RULES_OTHER)
        out, err, _ = py(c, "print(' '.join(d.program('q.dl')))", env)
        check(out.startswith('souffle ') and binp not in out, 'control: a copy whose rules differ gets no binary of the other rules', out)

        # 3. a binary an older plugin compiled into its own dl/.cache is still used
        e = plugin(work, 'copy-e'); key, _, _ = py(e, "print(d.rules_id(d.resolve('q.dl')))", env)
        os.makedirs(os.path.join(e, 'dl', '.cache')); legacy = os.path.join(e, 'dl', '.cache', f'q-{key}'); shutil.copy(binp, legacy)
        env2 = dict(env, XDG_CACHE_HOME=os.path.join(work, 'xdg-empty'))
        out, err, _ = py(e, "print(d.program('q.dl')[0])", env2)
        check(out == legacy, "a binary left in the plugin's dl/.cache by an older version is used", out + err)
        # ... unless it was built for another machine: a plugin copy synced from a Mac to Linux (or back) carries the
        # other machine's binary under the right name, and running it was an OSError (Exec format error) mid-query
        g = plugin(work, 'copy-g'); os.makedirs(os.path.join(g, 'dl', '.cache')); foreign = os.path.join(g, 'dl', '.cache', f'q-{key}')
        with open(foreign, 'wb') as fh:
            fh.write(b'\xcf\xfa\xed\xfe\x0c\x00\x00\x01' + b'\0' * 24 if sys.platform.startswith('linux')
                     else b'\x7fELF\x02\x01\x01\x00' + b'\0' * 10 + b'\x3e\x00' + b'\0' * 12)
        os.chmod(foreign, 0o755)
        out, err, _ = py(g, "print(' '.join(d.program('q.dl')))", env2)
        check(out.startswith('souffle ') and foreign not in out, "a dl/.cache binary built for another OS is not run: the interpreter answers", out + err)
        out, _, _ = py(e, f"print(d.runs_here({legacy!r}))", env2)
        check(out == 'True', 'control: the same check passes the binary this machine compiled', out)

        # 4. three queries at once on a cold cache: one compile, nothing left behind
        env3 = dict(env, XDG_CACHE_HOME=os.path.join(work, 'xdg-race')); q3 = os.path.join(work, 'xdg-race', 'axiomcode', 'queries')
        f = plugin(work, 'copy-f')
        procs = [subprocess.Popen([sys.executable, '-c', "import sys; sys.path.insert(0, sys.argv[1]); import dl_program as d; print(d.program('q.dl')[0])", f],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env3) for _ in range(3)]
        outs = [p.communicate()[0].strip() for p in procs]
        check(all(o == 'souffle' for o in outs), 'three queries at once all answer from the interpreter, none waits', outs)
        def settled():
            return os.path.isdir(q3) and any(n.startswith('q-') and '.' not in n for n in os.listdir(q3)) \
                and not any(n.endswith('.lock') for n in os.listdir(q3))
        wait_for(settled)
        left = sorted(os.listdir(q3)) if os.path.isdir(q3) else []
        check(len([n for n in left if n.startswith('q-') and '.' not in n]) == 1 and not [n for n in left if n.endswith(('.lock', '.cpp', '.tmp', '.nocompile'))],
              'they leave one binary and no lock, .cpp, .tmp or failure marker', left)

        # 5. the interpreter and the binary derive the same rows
        facts = os.path.join(work, 'facts'); os.makedirs(facts)
        with open(os.path.join(facts, 'e.facts'), 'w') as fh: fh.write('1\t2\n2\t3\n3\t4\n7\t8\n')
        rows = {}
        for how, argv in (('interpreter', ['souffle', os.path.join(a, 'dl', 'q.dl')]), ('binary', [binp])):
            o = os.path.join(work, 'out-' + how); os.makedirs(o)
            subprocess.run(argv + ['-F', facts, '-D', o], check=True, capture_output=True)
            rows[how] = sorted(l for l in open(os.path.join(o, 'r.csv')).read().split('\n') if l)
        check(rows['interpreter'] == rows['binary'] and len(rows['binary']) >= 7, f"the interpreter and the binary derive the same {len(rows['binary'])} rows", rows)

        # 6. what `axiomcode index` prints
        out, err, _ = py(b, "d.warm()", env)
        check('datalog rules ready: 1/1 compiled (q.dl=cached)' in out, 'warm() reports every program compiled', out + err)
        out, err, _ = py(c, "d.warm(wait=False)", env)
        check('q.dl=compiling' in out or 'q.dl=cached' in out, 'warm(wait=False) on new rules starts their compile and does not wait', out + err)
        wait_for(lambda: not any(n.endswith('.lock') for n in os.listdir(qdir)), 240)
    finally:
        if verbose: print('kept', work)
        else: shutil.rmtree(work, ignore_errors=True)
    print(f"{passed} passed, {len(fails)} FAILED" if fails else f'{passed} passed, all checks held')
    return 1 if fails or passed < 1 else 0


if __name__ == '__main__':
    sys.exit(main())
