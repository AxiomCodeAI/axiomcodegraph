#!/usr/bin/env python3
"""tests/graph_verb.py — `axiomcode graph` draws the graph the index built, and rebuilds it only as it was indexed.

It used to run axiomcode-build with no flags. That detects every language in the tree, so on a repository indexed with
--lang python the build never matched the recorded graph: every call rebuilt it from scratch in every language
present, a JavaScript or TypeScript compile for a few stray files included, and left a graph for each of them that
later queries answered from. Its output was a raw Python dict and a relative ../../ page path.

Two throwaway repositories:

  indexed    Python under app/, with a stray JavaScript file beside it, indexed with --lang python --src app
    current    the page is drawn from the graph: no engine run (the graph file is untouched), no graph for another
               language, prose counts and the page's absolute path
    stale      after an edit the graph is rebuilt with --lang python --src app, the page shows the edit, and still no
               JavaScript graph appears
  control    Python and Java, indexed with no --lang (every language): the page draws both, and both graphs stay;
             detected languages are not pinned, so a rebuild still detects them
  rebuilds   C# with a stray TypeScript front end, indexed with --lang csharp: an edit plus a commit (the background
             refresh), a bare `index` and a query that repairs a broken graph each solve C# alone
  surfaces   `axiomcode help graph` and the MCP tool's description describe this, not `axiomcode-graph build`

    python3 tests/graph_verb.py [-v]
"""
import os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')
MCP = os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp', 'server.py')
FRESH = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'ax_fresh.py')

INDEXED = {
    'app/shop/__init__.py': '',
    'app/shop/orders.py': 'def price(n):\n    return n * 3\n\n\ndef order_total(n):\n    return price(n) + 1\n',
    'app/shop/cli.py': 'from shop.orders import order_total\n\n\ndef main():\n    return order_total(2)\n',
    'app/static/widget.js': 'function strayWidget(a) {\n  return a + 1\n}\n\nmodule.exports = { strayWidget }\n',
    'tools/other.py': 'def outside_src():\n    return 1\n',
}
CSHARP = {
    'App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n</Project>\n',
    'App/Orders.cs': 'namespace App;\n\npublic class OrderService\n{\n    public decimal Total(int widgets) => Price(widgets) * 2;\n\n    private decimal Price(int widgets) => widgets * 3m;\n}\n',
    'App/ClientApp/tsconfig.json': '{ "compilerOptions": { "strict": true } }\n',
    'App/ClientApp/main.ts': 'export function strayFrontEnd(): number {\n  return 1\n}\n',
}
MIXED = {
    'pom.xml': '<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>example</groupId>\n  <artifactId>mixed</artifactId>\n  <version>1.0</version>\n</project>\n',
    'src/main/java/app/Billing.java': 'package app;\n\npublic class Billing {\n    public int chargeAccount(int n) {\n        return fee(n) + n;\n    }\n\n    int fee(int n) {\n        return 2;\n    }\n}\n',
    'src/main/java/app/Invoice.java': 'package app;\n\npublic class Invoice {\n    public int issueInvoice() {\n        return new Billing().chargeAccount(3);\n    }\n}\n',
    'scripts/report/__init__.py': '',
    'scripts/report/make.py': 'def render_report(x):\n    return str(x)\n\n\ndef main():\n    return render_report(1)\n',
}


def sh(cwd, *cmd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def make(root, files):
    for rel, text in files.items():
        os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
        open(os.path.join(root, rel), 'w').write(text)
    for cmd in (('git', 'init', '-q'), ('git', 'add', '-A'), ('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')):
        sh(root, *cmd)


def main(argv):
    verbose = '-v' in argv
    fails = []

    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok and not verbose or not detail else '\n     ' + detail.strip()[-1500:].replace('\n', '\n     ')))
        if not ok: fails.append(why)

    work = os.path.realpath(tempfile.mkdtemp(prefix='axiomcode-graphverb-'))   # macOS: /var is /private/var, and the page is named by its real path
    # the engine is this checkout's, unless the caller names a built one (a worktree whose parser is not built)
    env = dict(os.environ, AXIOMCODE_ENGINE=os.environ.get('AXIOMCODE_ENGINE') or ROOT, AXIOMCODE_NO_REFRESH='1')
    for k in ('AXIOMCODE_LANG', 'AXIOMCODE_SRC', 'AXIOMCODE_LIBRARY', 'AXIOMCODE_GRAPH'): env.pop(k, None)
    try:
        # ── indexed with --lang python --src app ──────────────────────────────────────────────────────────────
        repo = os.path.join(work, 'indexed'); make(repo, INDEXED)
        ax = os.path.join(repo, '.axiomcode'); db = os.path.join(ax, 'out', 'graph.sqlite')
        b = sh(repo, 'bash', AX, 'index', repo, '--lang', 'python', '--src', 'app', env=env)
        check(b.returncode == 0 and os.path.exists(db), 'setup: the repository indexes with --lang python --src app', b.stdout + b.stderr)
        if b.returncode: return 1
        before = (os.path.realpath(db), os.stat(os.path.realpath(db)).st_mtime_ns)

        t0 = time.time(); g = sh(repo, 'bash', AX, 'graph', repo, env=env); took = time.time() - t0
        page = os.path.join(ax, 'graph', 'graph.html')
        check(g.returncode == 0 and os.path.exists(page), 'current: the page is written', g.stdout + g.stderr)
        check((os.path.realpath(db), os.stat(os.path.realpath(db)).st_mtime_ns) == before and 'no rebuild' in g.stdout and 'building' not in g.stdout,
              f'current: the page is drawn from the graph there, the engine does not run ({took:.1f} s)', g.stdout + g.stderr)
        check(not os.path.exists(os.path.join(ax, 'lang')) and not os.path.exists(os.path.join(ax, 'out', 'javascript')),
              'current: no graph appears for the stray JavaScript file the index left out', g.stdout)
        check(f'page: {page}' in g.stdout and '../' not in g.stdout and "{'" not in g.stdout and ' functions and methods' in g.stdout,
              'current: the output is prose, and names the page by its absolute path', g.stdout)
        check('axiomcode-graph build' not in g.stdout + g.stderr, 'current: it advises no command an agent does not have', g.stdout + g.stderr)
        html = open(page).read() if os.path.exists(page) else ''
        check('order_total' in html and 'strayWidget' not in html and 'outside_src' not in html,
              'current: the page holds the indexed Python and nothing outside --lang / --src', '')

        # an edit: the graph is stale, and is rebuilt as it was indexed
        with open(os.path.join(repo, 'app', 'shop', 'orders.py'), 'a') as f: f.write('\n\ndef refund_order(n):\n    return -order_total(n)\n')
        # read-only first: --no-refresh (and AXIOMCODE_NO_REFRESH=1, which this env sets) draws the stale graph as it is
        stamp = (os.path.realpath(db), os.stat(os.path.realpath(db)).st_mtime_ns)
        g = sh(repo, 'bash', AX, 'graph', repo, '--no-refresh', env=env)
        check(g.returncode == 0 and 'refresh off (--no-refresh): drawn from the graph as it is' in g.stdout
              and 'predates edits to 1 file(s)' in g.stdout and (os.path.realpath(db), os.stat(os.path.realpath(db)).st_mtime_ns) == stamp,
              'stale: --no-refresh draws the graph as it is, says it is out of date, and never rebuilds it', g.stdout + g.stderr)
        # the near-miss: asked without it (and with no AXIOMCODE_NO_REFRESH), the stale graph is rebuilt as it was indexed
        g = sh(repo, 'bash', AX, 'graph', repo, env={k: v for k, v in env.items() if k != 'AXIOMCODE_NO_REFRESH'})
        html = open(page).read() if os.path.exists(page) else ''
        check(g.returncode == 0 and 'refund_order' in html and 'rebuilt (--lang python --src app)' in g.stdout,
              'stale: the graph is rebuilt with the --lang and --src it was indexed with, and the page shows the edit', g.stdout + g.stderr)
        check(not os.path.exists(os.path.join(ax, 'lang')) and 'building python graph' in g.stdout and 'javascript graph' not in g.stdout and '+ javascript' not in g.stdout,
              'stale: the rebuild solves Python alone; no JavaScript graph appears', g.stdout)
        check('outside_src' not in html, 'stale: the rebuild keeps --src (a file outside it is not drawn)', '')
        # the rebuild is a refresh: the baseline stays HEAD's tree, so the edit is still an edit to `changed`/`test-impact`
        c = sh(repo, 'bash', AX, 'changed', repo, env=env); ti = sh(repo, 'bash', AX, 'test-impact', repo, env=env)
        check('refund_order' in c.stdout and 'baseline moved' not in c.stdout + ti.stdout,
              'stale: the rebuild keeps the baseline: `changed` still names the edit, and nothing says the baseline moved',
              c.stdout + c.stderr + ti.stdout)
        # control: an explicit index of the edited tree DOES move the baseline (#1222), and now says so where the edit vanished
        with open(os.path.join(repo, 'app', 'shop', 'orders.py'), 'a') as f: f.write('\n\ndef void_order(n):\n    return 0\n')
        b = sh(repo, 'bash', AX, 'index', repo, '--lang', 'python', '--src', 'app', env=env)
        c = sh(repo, 'bash', AX, 'changed', repo, env=env); ti = sh(repo, 'bash', AX, 'test-impact', repo, env=env)
        check(b.returncode == 0 and 'refund_order' not in c.stdout and 'void_order' not in c.stdout
              and 'baseline moved' in c.stdout and 'shop/orders.py' in c.stdout and 'axiomcode index' in c.stdout and 'baseline moved' in ti.stdout,
              'control: an explicit index of an edited tree moves the baseline, and `changed` and `test-impact` say so, naming the file',
              b.stdout[-300:] + c.stdout + c.stderr + ti.stdout)

        # ── control: indexed with no --lang, every language present ──────────────────────────────────────────
        mixed = os.path.join(work, 'mixed'); make(mixed, MIXED)
        b = sh(mixed, 'bash', AX, 'index', mixed, env=env)
        mx = os.path.join(mixed, '.axiomcode')
        both = [os.path.exists(os.path.join(mx, 'out', 'graph.sqlite')), os.path.exists(os.path.join(mx, 'lang', 'python', 'out', 'graph.sqlite'))]
        check(b.returncode == 0 and all(both), 'control: a Java and Python repository indexed with no --lang has both graphs', b.stdout + b.stderr)
        g = sh(mixed, 'bash', AX, 'graph', mixed, env=env)
        mpage = os.path.join(mx, 'graph', 'graph.html')
        html = open(mpage).read() if os.path.exists(mpage) else ''
        check(g.returncode == 0 and 'chargeAccount' in html and 'render_report' in html and any(l.startswith('graph of ') and 'java' in l and 'python' in l for l in g.stdout.splitlines()),
              'control: the page draws every language the repository was indexed in', g.stdout + g.stderr)
        check(os.path.exists(os.path.join(mx, 'lang', 'python', 'out', 'graph.sqlite')) and 'no rebuild' in g.stdout,
              'control: drawing it keeps both graphs and rebuilds neither', g.stdout)
        c = sh(mixed, sys.executable, FRESH, 'chosen', mixed, env=env)
        check(c.returncode == 0 and c.stdout.strip() == '', 'control: languages that were detected are not pinned; a rebuild detects them again', c.stdout)

        # ── every rebuild path: C# indexed with --lang csharp, a stray TypeScript front end beside it ─────────────
        cs = os.path.join(work, 'csharp'); make(cs, CSHARP); cx = os.path.join(cs, '.axiomcode')
        b = sh(cs, 'bash', AX, 'index', cs, '--lang', 'csharp', env=env)
        check(b.returncode == 0 and os.path.exists(os.path.join(cx, 'out', 'graph.sqlite')) and not os.path.exists(os.path.join(cx, 'lang')),
              'rebuilds: a C# repository indexes with --lang csharp and no TypeScript graph', b.stdout + b.stderr)
        c = sh(cs, sys.executable, FRESH, 'chosen', cs, env=env)
        check(c.stdout.strip() == 'csharp', 'rebuilds: the file table records csharp as chosen', c.stdout)
        # an edit, committed, then the background refresh: the path a hook or the MCP server's timer starts
        with open(os.path.join(cs, 'App', 'Orders.cs'), 'a') as f: f.write('\n// committed edit\n')
        sh(cs, 'git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'edit')
        w = sh(cs, sys.executable, FRESH, 'worker', cs, env=dict(env, AXIOMCODE_REFRESH_DEBOUNCE='0.3'))
        stamp = lambda: open(os.path.join(cx, 'out', 'stamp')).read().strip() if os.path.exists(os.path.join(cx, 'out', 'stamp')) else ''
        no_ts = lambda: not os.path.exists(os.path.join(cx, 'lang')) and not os.path.exists(os.path.join(cx, 'out', 'typescript'))
        check(w.returncode == 0 and 'rebuilding' in w.stdout and '-csharp-' in stamp() and no_ts(),
              'rebuilds: an edit plus a commit refreshes C# alone; no TypeScript graph, no TypeScript solve', w.stdout + stamp())
        # a bare index, as an agent re-runs one "to make sure"
        b = sh(cs, 'bash', AX, 'index', cs, env=env)
        check(b.returncode == 0 and 'keeping the languages this graph was indexed with (--lang csharp)' in b.stdout and '-csharp-' in stamp() and no_ts(),
              'rebuilds: a bare index keeps --lang csharp and says so', b.stdout + b.stderr)
        # a query that finds the graph pointer broken repairs it, with the same languages
        ptr = os.path.join(cx, 'out', 'graph.sqlite'); tgt = os.path.realpath(ptr)
        os.rename(tgt, tgt + '.gone')
        q = sh(cs, 'bash', AX, 'impact', 'OrderService.Total', cs, env=env)
        check(q.returncode == 0 and os.path.exists(ptr) and '-csharp-' in stamp() and no_ts(),
              'rebuilds: a query repairing a broken graph builds C# alone', q.stdout[-600:] + q.stderr[-600:])

        # ── surfaces ──────────────────────────────────────────────────────────────────────────────────────────
        h = sh(ROOT, 'bash', AX, 'help', 'graph', env=env)
        check(h.returncode == 0 and 'axiomcode graph [<repo>]' in h.stdout and 'axiomcode-graph build' not in h.stdout and 'as it was indexed' in h.stdout,
              '`axiomcode help graph` names the verb agents call and says a stale graph is rebuilt as it was indexed', h.stdout)
        doc = open(MCP).read(); i = doc.index('def axiomcode_graph('); doc = doc[i:i + 1200]
        check('it was indexed with' in doc and 'absolute path' in doc, 'the MCP axiomcode_graph description says the same', doc)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'FAIL' if fails else 'ok'}: {len(fails)} of the checks above failed" if fails else '\nok: every check passed')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
