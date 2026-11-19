#!/usr/bin/env python3
"""tests/incidental_languages.py: a language a repository is not written in gets no graph unless asked for.

`axiomcode index` with no --lang built a graph for every language it found and picked the main one by file count: a
repository of one Python file and three trivial JavaScript files became a JavaScript repository with a Python graph
beside it, and a Python backend with a few .js build scripts got a second graph, a second section in every answer and
a cold JavaScript engine compile. Now a language other than the main one is incidental, and not built, when it has
fewer than 20 source files and either under 5% of the repository's code or under 100 lines in all; the main language
is the one with the most code (non-blank lines, each file counted up to 1,000), not the most files. The build names
what it left out and the --lang that includes it; an explicit --lang always wins (ax_fresh.py choose).

  choose          the rule itself, on the numbers (no engine): the shapes below, a repository of many small JavaScript
                  files and fewer bigger Python ones (Python is the main language), a vendored blob that does not make
                  its language the main one, web never the main language beside a call graph
  toy             1 .py + 3 trivial .js: a python graph only, and the build names javascript with `--lang python,javascript`
  backend         40 .py files that call each other + 3 .js build scripts in scripts/: python only, javascript named
  mixed (control) a TypeScript frontend and a Python backend of similar size: both graphs, nothing named as left out
  --lang          --lang javascript on the toy: the javascript graph, as asked, and no note
  --lang list     --lang python,javascript on the toy: both, as the note says

    python3 tests/incidental_languages.py [-v] [--no-engine]
"""
import os, shutil, sqlite3, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'bin', 'axiomcode')
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
sys.path.insert(0, SCRIPTS)
import ax_fresh  # noqa: E402

TOY = {
    'app.py': 'import os\n\n\ndef helper(x):\n    return x + 1\n\n\ndef main():\n    print(os.getcwd())\n    return helper(2)\n',
    'scripts/a.js': 'module.exports = function a() { return 1 }\n',
    'scripts/b.js': 'module.exports = function b() { return 2 }\n',
    'scripts/c.js': 'module.exports = function c() { return 3 }\n',
}


def backend():
    files = {'pyproject.toml': '[project]\nname = "svc"\nversion = "0.1"\n', 'svc/__init__.py': ''}
    for i in range(40):
        prev = f'from svc.m{i - 1} import step{i - 1}\n\n\n' if i else ''
        body = f'step{i - 1}(x) + {i}' if i else 'x'
        files[f'svc/m{i}.py'] = (f'{prev}def step{i}(x):\n    """step {i} of the pipeline"""\n    y = {body}\n    return y\n\n\n'
                                 f'def check{i}(x):\n    return step{i}(x) > 0\n')
    files['scripts/build.js'] = "const fs = require('fs')\n\nfunction build(dir) {\n  return fs.readdirSync(dir)\n}\n\nmodule.exports = { build }\n"
    files['scripts/migrate.js'] = "function migrate(db) {\n  return db.run('migrate')\n}\n\nmodule.exports = { migrate }\n"
    files['scripts/lint.js'] = "function lint(files) {\n  return files.filter(Boolean)\n}\n\nmodule.exports = { lint }\n"
    return files


def mixed():
    files = {'tsconfig.json': '{ "compilerOptions": { "strict": true }, "include": ["web"] }\n', 'api/__init__.py': ''}
    for i in range(8):
        files[f'web/view{i}.ts'] = (f"export function render{i}(items: string[]): string {{\n  const out: string[] = []\n"
                                    f"  for (const it of items) {{\n    out.push(label{i}(it))\n  }}\n  return out.join(',')\n}}\n\n"
                                    f"export function label{i}(s: string): string {{\n  const t = s.trim()\n  if (t.length === 0) {{\n"
                                    f"    return 'empty'\n  }}\n  return t.toUpperCase() + '{i}'\n}}\n")
        files[f'api/handler{i}.py'] = (f'def handle{i}(request):\n    """handler {i}"""\n    items = request.get("items", [])\n'
                                       f'    out = []\n    for it in items:\n        out.append(clean{i}(it))\n    return out\n\n\n'
                                       f'def clean{i}(s):\n    t = s.strip()\n    if not t:\n        return "empty"\n'
                                       f'    if t.startswith("#"):\n        return "comment"\n    return t.upper() + "{i}"\n')
    return files


def make(root, files):
    for rel, text in files.items():
        os.makedirs(os.path.dirname(os.path.join(root, rel)) or root, exist_ok=True)
        open(os.path.join(root, rel), 'w').write(text)
    for cmd in (('git', 'init', '-q'), ('git', 'add', '-A'), ('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')):
        subprocess.run(cmd, cwd=root, capture_output=True)
    return root


def chose(root):
    n, lines = ax_fresh.measure(root)
    return ax_fresh.choose(n, lines)


def graphs(repo):
    """{language: True} for every graph the repository has: the main one by its recorded language, the rest by directory"""
    out = {}
    try:
        con = sqlite3.connect(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite'))
        out[con.execute("SELECT value FROM run WHERE key = 'language'").fetchone()[0]] = True; con.close()
    except Exception: pass
    d = os.path.join(repo, '.axiomcode', 'lang')
    for l in (os.listdir(d) if os.path.isdir(d) else ()):
        if os.path.isfile(os.path.join(d, l, 'out', 'graph.sqlite')): out[l] = True
    return out


def main(argv):
    verbose, fails = '-v' in argv, []

    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok and not verbose or not detail else '\n     ' + str(detail).strip()[-1500:].replace('\n', '\n     ')))
        if not ok: fails.append(why)

    work = tempfile.mkdtemp(prefix='axiomcode-incidental-')
    try:
        toy = make(os.path.join(work, 'toy'), TOY)
        svc = make(os.path.join(work, 'backend'), backend())
        mix = make(os.path.join(work, 'mixed'), mixed())

        # ── choose: the rule on the numbers ──────────────────────────────────────────────────────────────────
        check(chose(toy) == ('python', ['python'], ['javascript']), 'choose: 1 .py + 3 trivial .js -> python, javascript left out', chose(toy))
        check(chose(svc) == ('python', ['python'], ['javascript']), 'choose: 40 .py + 3 .js build scripts -> python, javascript left out', chose(svc))
        check(chose(mix) == ('python', ['python', 'typescript'], []), 'choose (control): a TypeScript frontend and a Python backend of similar size -> both', chose(mix))
        z = {l: 0 for l in ax_fresh.ORDER}
        n = dict(z, python=300, javascript=400); lines = dict(z, python=30000, javascript=24000)
        check(ax_fresh.choose(n, lines)[0] == 'python', 'choose: fewer, bigger Python files outweigh more, smaller JavaScript ones')
        n = dict(z, java=400, javascript=150, typescript=18); lines = dict(z, java=20000, javascript=10000, typescript=1000)
        check(ax_fresh.choose(n, lines) == ('java', ['java', 'javascript'], ['typescript']),
              'choose: a frontend of 150 files is built, 18 stray TypeScript files at 3% are not', ax_fresh.choose(n, lines))
        n = dict(z, python=15, javascript=15); lines = dict(z, python=3000, javascript=200)
        check(ax_fresh.choose(n, lines)[1] == ['python', 'javascript'], 'choose (control): 15 files at 6% of the code are built')
        n = dict(z, java=61, web=1); lines = dict(z, java=3600, web=1000)
        check(ax_fresh.choose(n, lines)[0] == 'java', 'choose: web is never the main language beside a call graph')
        n = dict(z, web=4); lines = dict(z, web=50)
        check(ax_fresh.choose(n, lines) == ('web', ['web'], []), 'choose (control): a repository of pages alone is a web repository')
        n = dict(z, csharp=20, javascript=1); lines = dict(z, csharp=20000, javascript=10)
        check(ax_fresh.choose(n, lines)[2] == ['javascript'], 'choose: one stray script beside 20,000 lines of C# is left out')
        # a file counts up to 1,000 lines: a vendored 9,000-line table cannot make its language the main one
        big = make(os.path.join(work, 'vendored'), {'vendor/table.js': 'x,\n' * 9000, 'vendor/a.js': 'a\n', **{f'app/M{i}.java': 'class M%d {\n  int f() {\n    return %d;\n  }\n}\n' % (i, i) for i in range(300)}})
        check(chose(big)[0] == 'java', 'choose: a vendored 9,000-line file counts as 1,000 lines', chose(big))

        if '--no-engine' in argv: return report(fails)
        env = dict(os.environ, AXIOMCODE_ENGINE=ROOT, AXIOMCODE_NO_REFRESH='1')
        for k in ('AXIOMCODE_LANG', 'AXIOMCODE_GRAPH', 'AXIOMCODE_REINDEX'): env.pop(k, None)

        def index(repo, *extra):
            r = subprocess.run([AX, 'index', repo, *extra], capture_output=True, text=True, env=env, timeout=1800)
            return r.returncode, r.stdout + r.stderr

        # ── toy ──────────────────────────────────────────────────────────────────────────────────────────────
        rc, out = index(toy)
        check(rc == 0 and graphs(toy) == {'python': True}, 'toy: 1 .py + 3 .js builds the python graph only', out)
        check('not indexed, incidental' in out and 'javascript (3 files' in out and 'axiomcode index --lang python,javascript' in out,
              'toy: the build names javascript as left out, and the --lang that includes it', out)
        rc, out = index(toy)
        check(rc == 0 and 'axiomcode index --lang python,javascript' in out, 'toy: an index with nothing to do still names it', out)

        # ── backend ──────────────────────────────────────────────────────────────────────────────────────────
        rc, out = index(svc)
        check(rc == 0 and graphs(svc) == {'python': True} and 'javascript (3 files' in out,
              'backend: 40 .py + 3 .js build scripts builds python only, and names javascript', out)
        r = subprocess.run([AX, 'impact', 'step3', svc], capture_output=True, text=True, env=env)
        check(r.returncode == 0 and '══' not in r.stdout and 'step4' in r.stdout,
              'backend: an answer has one section, the python graph\'s', r.stdout + r.stderr)

        # ── mixed (control) ──────────────────────────────────────────────────────────────────────────────────
        rc, out = index(mix)
        check(rc == 0 and graphs(mix) == {'python': True, 'typescript': True} and 'not indexed' not in out,
              'mixed (control): a TypeScript frontend and a Python backend of similar size get both graphs', out)

        # ── --lang ───────────────────────────────────────────────────────────────────────────────────────────
        rc, out = index(toy, '--lang', 'javascript')
        check(rc == 0 and graphs(toy) == {'javascript': True} and 'not indexed' not in out,
              '--lang javascript: the javascript graph, as asked, and no note', out)
        rc, out = index(toy, '--lang', 'python,javascript')
        check(rc == 0 and graphs(toy) == {'python': True, 'javascript': True} and 'not indexed' not in out,
              '--lang python,javascript: both graphs, as the note said', out)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return report(fails)


def report(fails):
    print(f"\n{'FAILED ' + str(len(fails)) if fails else 'all passed'}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
