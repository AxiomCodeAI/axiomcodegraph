#!/usr/bin/env python3
"""tests/multi_language.py — a repository in several languages is indexed in all of them, and asked in all of them.

It used to be indexed as the language with the most files, and every other language was dropped without a word: no
symbol, no edge, and `changed` on an edit in the dropped language said the edit touched nothing the graph knows. Each
language now has its own graph (the main one where it always was, the others in .axiomcode/lang/<lang>), and the
query verbs ask all of them. A graph holds one language; no call is followed from one to another.

One throwaway repository in TypeScript (the main language: most files), Python and JavaScript:

  build          every language gets a graph, and the build names each
  queries        a name declared in each language is found, in its own graph; one that is nowhere is refused once
  compatible     a name only the main graph holds is answered exactly as that graph answers alone (no header, same
                 bytes), and --json keeps its shape, adding `other_languages` only when several graphs answer
  changed        an edit in two languages is reported once each, by the graph of its language; a clean tree once
  refresh        an edit in a language other than the main one makes the graph stale, and a query sees it
  --lang         restricting the languages removes the others' graphs, which must not keep answering
  upgrade        a graph built before this (one language, a file table without `lang_auto`) is stale in a repository
                 with other languages, so the first refresh indexes them
  control        a repository in one language gets no .axiomcode/lang and no fan-out

    python3 tests/multi_language.py [-v]
"""
import json, os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'bin', 'axiomcode')
FRESH = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'ax_fresh.py')

FILES = {
    'tsconfig.json': '{ "compilerOptions": { "strict": true }, "include": ["src"] }\n',
    'src/util.ts': 'export function square(x: number): number {\n  return x * x\n}\n',
    'src/shape.ts': 'import { square } from \'./util\'\n\nexport function area(r: number): number {\n  return 3 * square(r)\n}\n',
    'src/main.ts': 'import { area } from \'./shape\'\n\nexport function run(): number {\n  return area(2)\n}\n',
    'src/extra.ts': 'export function onlyInTs(): number {\n  return 7\n}\n',
    'tools/pkg/__init__.py': '',
    'tools/pkg/calc.py': 'def add(a, b):\n    return a + b\n\n\ndef total(xs):\n    t = 0\n    for x in xs:\n        t = add(t, x)\n    return t\n',
    'jslib/package.json': '{ "name": "jslib", "version": "1.0.0", "main": "index.js" }\n',
    'jslib/index.js': 'function helper(a) {\n  return a + 1\n}\n\nfunction api(a) {\n  return helper(a) * 2\n}\n\nmodule.exports = { api }\n',
}


def sh(cwd, *cmd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def make(root, files):
    for rel, text in files.items():
        os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
        open(os.path.join(root, rel), 'w').write(text)
    for cmd in (('git', 'init', '-q'), ('git', 'add', '-A'), ('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')):
        sh(root, *cmd)


def settle(repo, env):
    """wait until no background refresh is running: a query that refreshed starts one, and a check that reads the
    graph's state or rebuilds it must not race it"""
    # the refresher loops: after a rebuild it waits out the debounce and checks again, so one look between two of its
    # passes is not quiet. Quiet is several seconds with no build
    deadline, quiet_since = time.time() + 600, None
    while time.time() < deadline:
        busy = json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=env).stdout or '{}').get('state') == 'building'
        quiet_since = None if busy else (quiet_since or time.time())
        if quiet_since and time.time() - quiet_since > 3: return
        time.sleep(0.2)


def main(argv):
    verbose = '-v' in argv
    fails = []

    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok and not verbose or not detail else '\n     ' + detail.strip()[-1500:].replace('\n', '\n     ')))
        if not ok: fails.append(why)

    work = tempfile.mkdtemp(prefix='axiomcode-multi-')
    env = dict(os.environ, AXIOMCODE_ENGINE=ROOT, AXIOMCODE_REFRESH_DEBOUNCE='0.5', AXIOMCODE_FRESH_WAIT='600')
    env.pop('AXIOMCODE_LANG', None); env.pop('AXIOMCODE_GRAPH', None)
    quiet = dict(env, AXIOMCODE_NO_REFRESH='1')
    try:
        repo = os.path.join(work, 'mixed'); make(repo, FILES)
        lang_dir = os.path.join(repo, '.axiomcode', 'lang')

        # ── build ─────────────────────────────────────────────────────────────────────────────────────────────
        b = sh(repo, AX, 'index', '.', env=quiet)
        graphs = {l: os.path.exists(os.path.join(lang_dir, l, 'out', 'graph.sqlite')) for l in ('python', 'javascript')}
        check(b.returncode == 0 and all(graphs.values()) and os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')),
              'build: the main language (typescript) and every other language (python, javascript) get a graph', b.stdout + b.stderr + json.dumps(graphs))
        check('typescript + python + javascript' in b.stdout and '(python)' in b.stdout and '(javascript)' in b.stdout,
              'build: the output names every language it indexed', b.stdout)
        if b.returncode: return 1

        # ── queries ───────────────────────────────────────────────────────────────────────────────────────────
        p = sh(repo, AX, 'impact', 'add', '.', env=quiet)
        check(p.returncode == 0 and '══ python graph' in p.stdout and 'tools/pkg/calc.py' in p.stdout and 'total' in p.stdout,
              'queries: a Python function in a TypeScript repository is found, with its caller, in the python graph', p.stdout + p.stderr)
        j = sh(repo, AX, 'path', 'api', 'helper', '.', env=quiet)
        check(j.returncode == 0 and 'verified' in j.stdout and '══ javascript graph' in j.stdout,
              'queries: a JavaScript chain is found in the javascript graph', j.stdout + j.stderr)
        n = sh(repo, AX, 'impact', 'nowhereAtAll', '.', env=quiet)
        check(n.returncode != 0 and n.stdout.count('nothing named') == 1,
              'queries: a name in no graph is refused, once, with a non-zero status', n.stdout + n.stderr)

        # ── compatible ────────────────────────────────────────────────────────────────────────────────────────
        alone = sh(repo, AX, 'impact', 'onlyInTs', '.', env=dict(quiet, AXIOMCODE_GRAPH=os.path.join(repo, '.axiomcode')))
        fan = sh(repo, AX, 'impact', 'onlyInTs', '.', env=quiet)
        check(fan.returncode == 0 and fan.stdout == alone.stdout and '══' not in fan.stdout,
              'compatible: a name only the main graph holds is answered exactly as the main graph answers alone', f"alone:\n{alone.stdout}\nfanned out:\n{fan.stdout}")
        js = sh(repo, AX, 'impact', 'square', '.', '--json', env=quiet)
        try: d = json.loads(js.stdout)
        except ValueError: d = {}
        check('direct' in d and 'other_languages' not in d and any('shape.ts' in (e.get('at') or '') for e in d.get('direct', [])),
              'compatible: --json from one graph is that graph\'s object, unchanged in shape', js.stdout[-800:] + js.stderr)

        # ── changed ───────────────────────────────────────────────────────────────────────────────────────────
        calc = os.path.join(repo, 'tools/pkg/calc.py'); util = os.path.join(repo, 'src/util.ts')
        open(calc, 'w').write(FILES['tools/pkg/calc.py'].replace('return a + b', 'return b + a'))
        open(util, 'w').write(FILES['src/util.ts'].replace('return x * x', 'return x * x * 1'))
        c = sh(repo, AX, 'changed', '.', env=quiet)
        check(c.returncode == 0 and c.stdout.count('add ') == 1 and c.stdout.count('square ') == 1 and 'no declarations known here' not in c.stdout
              and '══ javascript graph' not in c.stdout,
              'changed: a Python edit and a TypeScript edit are each reported once, by the graph of their language', c.stdout + c.stderr)
        cj = sh(repo, AX, 'changed', '.', '--json', env=quiet)
        try: d = json.loads(cj.stdout)
        except ValueError: d = {}
        syms = sorted([e['symbol'] for e in d.get('changed', [])] + [e['symbol'] for o in d.get('other_languages', {}).values() for e in o.get('changed', [])])
        check(syms == ['add', 'square'], 'changed --json: both edits, the other language\'s under other_languages', cj.stdout[-800:])
        t = sh(repo, AX, 'test-impact', '.', env=quiet)
        check(t.returncode == 0 and 'add [body]' in t.stdout and 'square' in t.stdout, 'test-impact: starts from the edits in both languages', t.stdout + t.stderr)
        sh(repo, 'git', 'checkout', '-q', '--', '.')
        c = sh(repo, AX, 'changed', '.', env=quiet)
        check(c.returncode == 0 and c.stdout.count('no change to a declaration') == 1 and '══' not in c.stdout,
              'changed: a clean tree is one "no change", as in a repository of one language', c.stdout + c.stderr)

        # ── refresh ───────────────────────────────────────────────────────────────────────────────────────────
        open(calc, 'a').write('\n\ndef added_later(xs):\n    return total(xs)\n')
        st = json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=quiet).stdout or '{}')
        check(st.get('state') == 'stale' and 'tools/pkg/calc.py' in st.get('changed', []),
              'refresh: an edit in a language other than the main one makes the graph stale', json.dumps(st))
        q = sh(repo, AX, 'path', 'added_later', 'add', '.', env=env)
        check(q.returncode == 0 and 'verified' in q.stdout, 'refresh: a query refreshes the graphs and finds the new Python function', q.stdout + q.stderr)
        sh(repo, 'git', 'checkout', '-q', '--', '.')
        settle(repo, quiet)

        # ── --lang ────────────────────────────────────────────────────────────────────────────────────────────
        r = sh(repo, AX, 'index', '.', '--lang', 'typescript', env=quiet)
        check(r.returncode == 0 and (not os.path.exists(lang_dir) or not os.listdir(lang_dir)),
              '--lang: restricting to one language removes the other languages\' graphs', r.stdout + r.stderr)
        g = sh(repo, AX, 'impact', 'add', '.', env=quiet)
        check(g.returncode != 0, '--lang: and a name in a removed language is no longer answered', g.stdout)

        # ── upgrade ───────────────────────────────────────────────────────────────────────────────────────────
        settle(repo, quiet)
        tp = os.path.join(repo, '.axiomcode', 'out', 'files.json'); tab = json.load(open(tp))
        tab.pop('lang_auto', None); json.dump(tab, open(tp, 'w'))       # as a build from before this wrote it
        st = json.loads(sh(repo, sys.executable, FRESH, 'status', '.', '--json', env=quiet).stdout or '{}')
        check(st.get('state') == 'stale', 'upgrade: a one-language graph from before is stale in a repository with other languages', json.dumps(st))
        q = sh(repo, AX, 'impact', 'add', '.', env=env)
        check(q.returncode == 0 and '══ python graph' in q.stdout, 'upgrade: and the first query indexes them', q.stdout + q.stderr)

        # ── control ───────────────────────────────────────────────────────────────────────────────────────────
        one = os.path.join(work, 'one'); make(one, {k: v for k, v in FILES.items() if k.startswith(('src/', 'tsconfig'))})
        b = sh(one, AX, 'index', '.', env=quiet)
        check(b.returncode == 0 and not os.path.exists(os.path.join(one, '.axiomcode', 'lang')) and 'building typescript graph for' in b.stdout,
              'control: a repository in one language builds one graph, as before', b.stdout + b.stderr)
        tab = json.load(open(os.path.join(one, '.axiomcode', 'out', 'files.json')))
        check(tab.get('lang') == 'typescript', 'control: its file table names the one language', json.dumps({k: tab.get(k) for k in ('lang', 'lang_auto')}))
        st = json.loads(sh(one, sys.executable, FRESH, 'status', '.', '--json', env=quiet).stdout or '{}')
        check(st.get('state') == 'fresh', 'control: and it is fresh', json.dumps(st))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'FAILED: ' + str(len(fails)) if fails else 'all passed'}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
