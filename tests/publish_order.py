#!/usr/bin/env python3
"""tests/publish_order.py: a repository in several languages is queryable as soon as its main language is solved.

The engine solves one language after another, and nearly all of each is that language's Souffle compile. The build
used to publish nothing until every language was done: on a C# web application with a small front end in another
language, the C# graph was written 131 s into the first index and the first query answered at 5,304 s (#1555).

The other languages are held back here on purpose: the engine is wrapped by one that runs the real engine,
reports the first language it solved, and holds the rest back until the test lets them go. Nothing else is faked.

One throwaway repository: a C# web API (the main language: most files), a small Java report job and some Python
scripts, more Python files than Java ones.

  order          the engine solves the main language first, then the others by file count (python before
                 java), though the fixed language order puts java first
  published      while the other languages are held, graph.sqlite already points at the C# graph and the build is
                 still running
  query          a C# question is answered then, at once, and says which languages it cannot see yet; a Java
                 name is refused without waiting for its compile
  rebuild        a rebuild that is past its main language still has the other languages' previous graphs: a query answers
                 at once, as every query during a refresh does, and says which languages it answered from old graphs
  finished       released, the build ends with every language's graph and no trace of the pending list
  first query    with no graph at all, a query builds one and answers when the C# graph is ready, not when the
                 build ends; the build goes on and still ends with every language's graph; the answer on stdout
                 carries none of the build's output
  main fails     a main language that fails fails the build, keeps the graph that was there, and publishes nothing
  control        a repository in one language builds as before: no pending list, no .axiomcode/lang, no note

    python3 tests/publish_order.py [-v]
"""
import json, os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'bin', 'axiomcode')
FRESH = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'ax_fresh.py')

CS = {
    'WebApp/WebApp.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n',
    'WebApp/Program.cs': 'using WebApp.Services;\n\nvar builder = WebApplication.CreateBuilder(args);\nbuilder.Services.AddScoped<IOrderService, OrderService>();\nvar app = builder.Build();\napp.Run();\n',
    'WebApp/Controllers/OrdersController.cs': 'using WebApp.Services;\n\nnamespace WebApp.Controllers;\n\npublic class OrdersController\n{\n    private readonly IOrderService _orders;\n\n    public OrdersController(IOrderService orders) => _orders = orders;\n\n    public decimal Get(int id) => _orders.Total(id);\n}\n',
    'WebApp/Services/OrderService.cs': 'namespace WebApp.Services;\n\npublic interface IOrderService\n{\n    decimal Total(int orderId);\n}\n\npublic class OrderService : IOrderService\n{\n    public decimal Total(int orderId) => Subtotal(orderId) * 1.2m;\n\n    private decimal Subtotal(int orderId) => orderId * 10m;\n}\n',
    'WebApp/Models/Order.cs': 'namespace WebApp.Models;\n\npublic record Order(int Id, decimal Amount);\n',
}
TOOLS = {
    'tools/report/pom.xml': '<project>\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>app</groupId>\n  <artifactId>report</artifactId>\n  <version>1.0</version>\n</project>\n',
    'tools/report/src/main/java/app/report/Formatter.java': 'package app.report;\n\npublic class Formatter {\n    public String money(double x) {\n        return String.format("%.2f", x);\n    }\n}\n',
    'tools/report/src/main/java/app/report/ReportJob.java': 'package app.report;\n\npublic class ReportJob {\n    private final Formatter formatter = new Formatter();\n\n    public String render(double total) {\n        return formatter.money(total);\n    }\n}\n',
    'tools/scripts/totals.py': 'def sum_totals(rows):\n    return sum(r["total"] for r in rows)\n',
    'tools/scripts/export.py': 'from totals import sum_totals\n\n\ndef export(rows):\n    return {"sum": sum_totals(rows)}\n',
    'tools/scripts/labels.py': 'def label(x):\n    return "total " + str(x)\n',
}

# the engine, wrapped: the real `all` runs, and the first language it names is passed on the moment it is named; the
# rest only once the real run has ended AND the HOLD file is gone. So the main graph is published while the real engine
# is still solving (a cold compile of the others' rules takes as long as it takes), and the test decides when the other
# languages arrive. Without --progress (a build that publishes nothing early) it holds the same way.
SHIM = r'''#!/usr/bin/env bash
REAL="$AXIOMCODE_TEST_REAL/bin/axiomcode"
[ "${1:-}" = all ] || exec "$REAL" "$@"
prog=""; args=(); next=""
for a in "$@"; do
  if [ -n "$next" ]; then prog="$a"; args+=("$a.real"); next=""; continue; fi
  [ "$a" = --progress ] && next=1; args+=("$a")
done
[ -z "$prog" ] || rm -f "$prog.real"
"$REAL" "${args[@]}" & pid=$!
if [ -n "$prog" ]; then
  while kill -0 "$pid" 2>/dev/null && [ ! -s "$prog.real" ]; do sleep 0.2; done
  first="$(head -1 "$prog.real" 2>/dev/null)"
  if [ -n "$first" ]; then
    [ -n "${AXIOMCODE_TEST_FAIL_MAIN:-}" ] && first="${first%% *} failed"
    echo "$first" >> "$prog"
  fi
fi
wait "$pid"; rc=$?
while [ -e "$AXIOMCODE_TEST_HOLD" ]; do sleep 0.2; done
[ -z "$prog" ] || tail -n +2 "$prog.real" >> "$prog"
exit $rc
'''


def sh(cwd, *cmd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def make(root, files):
    for rel, text in files.items():
        os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
        open(os.path.join(root, rel), 'w').write(text)
    for cmd in (('git', 'init', '-q'), ('git', 'add', '-A'), ('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')):
        sh(root, *cmd)


def until(cond, seconds):
    end = time.time() + seconds
    while time.time() < end:
        if cond(): return True
        time.sleep(0.2)
    return cond()


def main(argv):
    verbose = '-v' in argv
    fails = []

    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok and not verbose or not detail else '\n     ' + str(detail).strip()[-1500:].replace('\n', '\n     ')))
        if not ok: fails.append(why)

    work = os.path.realpath(tempfile.mkdtemp(prefix='axiomcode-publish-'))
    shim = os.path.join(work, 'engine')
    os.makedirs(os.path.join(shim, 'bin'))
    open(os.path.join(shim, 'bin', 'axiomcode'), 'w').write(SHIM); os.chmod(os.path.join(shim, 'bin', 'axiomcode'), 0o755)
    for n in ('graph', 'package.json', 'parser'): os.symlink(os.path.join(ROOT, n), os.path.join(shim, n))
    hold = os.path.join(work, 'hold')
    env = dict(os.environ, AXIOMCODE_ENGINE=shim, AXIOMCODE_TEST_REAL=ROOT, AXIOMCODE_TEST_HOLD=hold, AXIOMCODE_NO_REFRESH='1')
    for k in ('AXIOMCODE_LANG', 'AXIOMCODE_GRAPH', 'AXIOMCODE_GRAPH_LANG', 'AXIOMCODE_LIBRARY'): env.pop(k, None)
    procs = []
    try:
        repo = os.path.join(work, 'webapp'); make(repo, dict(CS, **TOOLS))
        out = os.path.join(repo, '.axiomcode', 'out'); lang = os.path.join(repo, '.axiomcode', 'lang')
        graph = os.path.join(out, 'graph.sqlite')

        # ── published ─────────────────────────────────────────────────────────────────────────────────────────
        open(hold, 'w').close()
        b = subprocess.Popen([AX, 'index', '.'], cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True); procs.append(b)
        up = until(lambda: os.path.exists(graph) or b.poll() is not None, 600)
        running = b.poll() is None
        check(up and os.path.exists(graph) and running,
              'published: graph.sqlite points at the main (C#) graph while the other languages are still being solved',
              f"graph={os.path.exists(graph)} running={running}")
        log = open(os.path.join(repo, '.axiomcode', 'build.log')).read() if os.path.exists(os.path.join(repo, '.axiomcode', 'build.log')) else ''
        check('▶ languages: csharp python java' in log,
              'order: the main language is solved first, then the others by file count (python 3 before java 2)',
              [l for l in log.splitlines() if 'languages' in l])
        if not (up and running): return 1
        until(lambda: os.path.exists(os.path.join(out, 'building')), 30)

        # ── query ─────────────────────────────────────────────────────────────────────────────────────────────
        t0 = time.time(); q = sh(repo, AX, 'impact', 'OrderService.Total', '.', env=env); dt = time.time() - t0
        check(q.returncode == 0 and 'OrdersController.Get' in q.stdout and b.poll() is None and dt < 60,
              'query: a C# question is answered while the other languages are held, without waiting for them',
              f"{dt:.1f}s\n{q.stdout}\n{q.stderr}")
        check('the python, java graphs are still being built' in q.stderr,
              'query: the answer names the languages whose graphs it cannot see yet', q.stderr)
        live = dict(env); live.pop('AXIOMCODE_NO_REFRESH')
        t0 = time.time(); q = sh(repo, AX, 'impact', 'OrderService.Total', '.', env=live); dt = time.time() - t0
        check(q.returncode == 0 and 'OrdersController.Get' in q.stdout and 'still being built' in q.stderr and dt < 60 and b.poll() is None,
              'query: with the refresher on, the same answer and note, and no wait for a refresh', f"{dt:.1f}s\n{q.stderr}")
        st = json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=env).stdout or '{}')
        check(st.get('state') == 'building' and st.get('pending') == ['python', 'java'] and st.get('first') is True,
              'query: status says building, with the pending languages in solve order, on a first build', json.dumps(st))
        t0 = time.time(); r = sh(repo, AX, 'impact', 'Formatter.money', '.', env=env); dt = time.time() - t0
        check(r.returncode != 0 and 'Formatter.money' in r.stdout + r.stderr and b.poll() is None and dt < 60,
              'query: a Java name is refused at once, not after the Java solve', f"{dt:.1f}s\n{r.stdout}\n{r.stderr}")

        # ── finished ──────────────────────────────────────────────────────────────────────────────────────────
        os.remove(hold)
        bout, _ = b.communicate(timeout=5400)
        have = {l: os.path.exists(os.path.join(lang, l, 'out', 'graph.sqlite')) for l in ('python', 'java')}
        check(b.returncode == 0 and all(have.values()) and not os.path.exists(os.path.join(out, 'building')) and not os.path.exists(os.path.join(out, '.progress')),
              'finished: the build ends with every language\'s graph, and the pending list is gone', bout + json.dumps(have))
        check(bout.index('csharp graph ready') < bout.index('python:') < bout.index('java:') and 'still building: python, java' in bout,
              'finished: the build says when the main graph is ready, then names each language as it is published', bout)
        r = sh(repo, AX, 'impact', 'Formatter.money', '.', env=env)
        check(r.returncode == 0 and 'ReportJob.render' in r.stdout and 'still being built' not in r.stderr,
              'finished: the Java name is answered from its own graph, with no note', r.stdout + r.stderr)

        # ── rebuild ───────────────────────────────────────────────────────────────────────────────────────────
        api = os.path.join(repo, 'tools/scripts/totals.py')
        open(api, 'a').write('\n\ndef added_later():\n    return 1\n')
        open(hold, 'w').close()
        b = subprocess.Popen([AX, 'index', '.'], cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True); procs.append(b)
        until(lambda: os.path.exists(os.path.join(out, 'building')) or b.poll() is not None, 600)
        t0 = time.time(); q = sh(repo, AX, 'impact', 'OrderService.Total', '.', env=live); dt = time.time() - t0
        check(q.returncode == 0 and 'OrdersController.Get' in q.stdout and dt < 60 and b.poll() is None
              and 'its python, java code comes from the previous graph' in q.stderr,
              'rebuild: past its main language, a query answers at once and says the other languages\' code is from their previous graphs',
              f"{dt:.1f}s\n{q.stderr}")
        os.remove(hold); b.communicate(timeout=5400)
        r = sh(repo, AX, 'impact', 'added_later', '.', env=env)
        check(b.returncode == 0 and r.returncode == 0 and 'totals.py' in r.stdout, 'rebuild: released, the edit is in the Python graph', r.stdout + r.stderr)
        sh(repo, 'git', 'checkout', '-q', '--', '.')

        # ── main fails ────────────────────────────────────────────────────────────────────────────────────────
        before = sh(repo, AX, 'impact', 'OrderService.Total', '.', env=env).stdout
        model = os.path.join(repo, 'WebApp/Models/Order.cs')
        open(model, 'a').write('\npublic record Line(int Qty);\n')             # a change, so the index rebuilds
        f = sh(repo, AX, 'index', '.', env=dict(env, AXIOMCODE_TEST_FAIL_MAIN='1'))
        after = sh(repo, AX, 'impact', 'OrderService.Total', '.', env=env)
        check(f.returncode != 0 and 'build failed' in f.stdout and after.returncode == 0 and after.stdout == before
              and not os.path.exists(os.path.join(out, 'building')),
              'main fails: the build fails, and the graph that was there answers exactly as before', f.stdout + f.stderr)
        sh(repo, 'git', 'checkout', '-q', '--', '.')

        # ── first query ───────────────────────────────────────────────────────────────────────────────────────
        shutil.rmtree(os.path.join(repo, '.axiomcode'))
        open(hold, 'w').close()
        t0 = time.time(); q = sh(repo, AX, 'impact', 'OrderService.Total', '.', env=env); dt = time.time() - t0
        held = os.path.exists(hold) and not os.path.exists(os.path.join(lang, 'java'))
        check(q.returncode == 0 and 'OrdersController.Get' in q.stdout and held,
              'first query: with no graph, the answer comes when the C# graph is ready, while the other languages are held',
              f"{dt:.1f}s held={held}\n{q.stdout}\n{q.stderr}")
        check('tier ' not in q.stdout and 'indexed ' not in q.stdout and 'indexed ' in q.stderr,
              'first query: the build\'s output goes to stderr, and the answer on stdout is only the answer', q.stdout[:600])
        check('still being built' in q.stderr, 'first query: the answer names the languages it cannot see yet', q.stderr[-600:])
        os.remove(hold)
        done = until(lambda: all(os.path.exists(os.path.join(lang, l, 'out', 'graph.sqlite')) for l in ('python', 'java'))
                     and not os.path.exists(os.path.join(out, 'building')), 600)
        check(done, 'first query: the build goes on after the answer and ends with every language\'s graph',
              open(os.path.join(repo, '.axiomcode', 'index.log')).read()[-800:] if os.path.exists(os.path.join(repo, '.axiomcode', 'index.log')) else '')

        # ── control ───────────────────────────────────────────────────────────────────────────────────────────
        one = os.path.join(work, 'api-only'); make(one, CS)
        c = sh(one, AX, 'index', '.', env=env)
        q = sh(one, AX, 'impact', 'OrderService.Total', '.', env=env)
        check(c.returncode == 0 and 'still building' not in c.stdout and not os.path.exists(os.path.join(one, '.axiomcode', 'lang'))
              and not os.path.exists(os.path.join(one, '.axiomcode', 'out', 'building')) and c.stdout.rstrip().endswith('graph at ' + os.path.join(one, '.axiomcode', 'out', 'graph.sqlite')),
              'control: a repository in one language builds as it did, with no pending list and no other graph', c.stdout + c.stderr)
        check(q.returncode == 0 and 'OrdersController.Get' in q.stdout and 'graph refresh' not in q.stderr,
              'control: its answer carries no note', q.stdout + q.stderr)
    finally:
        try: os.remove(hold)
        except OSError: pass
        for p in procs:
            if p.poll() is None: p.kill()
        time.sleep(1)
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'FAILED: ' + str(len(fails)) if fails else 'all passed'}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
