#!/usr/bin/env python3
"""tests/case_runner.py: a data-driven suite is run by its case runner, never by pytest on its fixtures.

A runner script beside a `cases/` directory walks it (tests/run.py reading tests/cases/<lang>/<case>/case.json,
graph/test/<lang>/run-tests.sh solving each cases/<case>/src). test-impact handed a changed case file to pytest (the
fixture's own test_*.py is data, nothing collects it), matched it by name against another case's files, and said "no
test names" a rule file the engine suite reads; impact said "tests: 0" for a program the suites start as a subprocess.

Each scenario edits a throwaway git repository and asks test-impact (and impact) what to run:

  - case data maps to the runner's command for that ONE case, as the runner's usage line spells it;
  - a golden beside the cases (expected/<case>.edges) maps to the same case;
  - a rule file under graph/<lang>/ maps to graph/test/<lang>/run-tests.sh, whole (the test tree mirrors it);
  - controls: a real pytest file next to the case data still runs with pytest; a fixture's own test_*.py is not
    selected; a script that only mentions cases/ in a comment is not a runner; another case's same-named file is
    not named;
  - a program started through a dispatcher (tools/cli execs tools/cli-<verb>.py) is credited to the test that starts
    the dispatcher, in test-impact and on impact's tests line;
  - a FIXTURE TREE of any name (tests/fastcases/, read by a script beside it through a joined path) is case data for
    that script, with its --lang flag; a golden a test opens by path maps to that test; `changed` calls a new file in
    a fixture tree case data, never "a test file: run it";
  - a data file's own name is no test-name match when other files share it (case.json, settings.json);
  - controls: a golden no test reads is not given its neighbour's test; the test that reads a golden, edited, still
    runs; a data file named by its own unique path keeps its test; a new real test file is still "run it".

    python3 tests/case_runner.py
"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'bin', 'axiomcode')
# internal verbs (context, changed, test-impact) left the installed command's surface: ask the dispatcher
DISP = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')

RUNNER_PY = '''#!/usr/bin/env python3
"""tests/run.py [<case> ...] [--lang python|java]

Each case is tests/cases/<lang>/<case>/ with a case.json.
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
lang = args[args.index('--lang') + 1] if '--lang' in args else None
only = [a for a in args if not a.startswith('-') and a != lang]
for l in sorted(os.listdir(os.path.join(HERE, 'cases'))):
    for c in sorted(os.listdir(os.path.join(HERE, 'cases', l))):
        if (not only or c in only) and (not lang or l == lang):
            json.load(open(os.path.join(HERE, 'cases', l, c, 'case.json')))
sys.exit(0)
'''

ENGINE_SH = '''#!/usr/bin/env bash
# engine suite
#   ./run-tests.sh           every case
#   ./run-tests.sh 01 02     only cases matching those substrings
HERE="$(cd "$(dirname "$0")" && pwd)"
for a in "$@"; do :; done
for dir in "$HERE"/cases/*/; do echo "$dir"; done
'''

ENGINE_CS_SH = '''#!/bin/bash
#   ./run-tests.sh                     every case
#   ./run-tests.sh --only 01-y         one case
HERE="$(cd "$(dirname "$0")" && pwd)"
while [ $# -gt 0 ]; do case "$1" in --only) ONLY="$2"; shift 2;; *) shift;; esac; done
for dir in "$HERE"/cases/*/; do echo "$dir"; done
'''

FILES = {
    'app/__init__.py': '',
    'app/core.py': 'def core(x):\n    return x + 1\n',
    # a real pytest test NEXT TO the case data: still pytest's
    'tests/test_real.py': 'from app.core import core\n\n\ndef test_core():\n    assert core(1) == 2\n',
    'tests/run.py': RUNNER_PY,
    # names cases/ only in a comment: not a runner
    'tests/notes.py': '# the loop in run.py iterates cases/*/ and reads each case.json\nif __name__ == "__main__":\n    print("notes")\n',
    'tests/cases/python/alpha/case.json': '{"checks": []}\n',
    'tests/cases/python/alpha/app/__init__.py': '',
    'tests/cases/python/alpha/app/pricing.py': 'def price(amount):\n    return amount * 1.2\n',
    'tests/cases/python/alpha/tests/test_pricing.py': 'from app.pricing import price\n\n\ndef test_price():\n    assert price(10) == 12\n',
    'tests/cases/python/beta/case.json': '{"checks": []}\n',
    'tests/cases/python/beta/app/__init__.py': '',
    'tests/cases/python/beta/app/pricing.py': 'def price(amount):\n    return amount\n',
    'tests/cases/python/beta/tests/test_pricing.py': 'from app.pricing import price\n\n\ndef test_price():\n    assert price(3) == 3\n',
    'tests/cases/java/gamma/case.json': '{"checks": []}\n',
    'tests/cases/java/gamma/src/A.java': 'class A { int f() { return 1; } }\n',
    'tests/cases/csharp/delta/case.json': '{"checks": []}\n',
    'tests/cases/csharp/delta/A.cs': 'class A { int F() { return 1; } }\n',
    'graph/python/engine/rules.dl': '.decl edge(a: symbol, b: symbol)\n',
    'graph/java/engine/rules.dl': '.decl edge(a: symbol, b: symbol)\n',
    'graph/csharp/engine/rules.dl': '.decl edge(a: symbol, b: symbol)\n',
    'graph/test/python/run-tests.sh': ENGINE_SH,
    'graph/test/python/cases/01-x/src/main.py': 'def main():\n    return 1\n',
    'graph/test/python/expected/01-x.edges': 'main -> x\n',
    'graph/test/java/run-tests.sh': ENGINE_SH,
    'graph/test/java/cases/01-z/src/A.java': 'class A {}\n',
    'graph/test/csharp/run-tests.sh': ENGINE_CS_SH,
    'graph/test/csharp/cases/01-y/src/B.cs': 'class B {}\n',
    # a dispatcher and the subcommand it execs, and the test that starts the dispatcher as a subprocess
    'tools/cli': '#!/usr/bin/env bash\nH="$(cd "$(dirname "$0")" && pwd)"\ncmd="$1"; shift\nexec python3 "$H/cli-$cmd.py" "$@"\n',
    'tools/cli-report.py': ('#!/usr/bin/env python3\nimport sys\n\n\ndef render(rows):\n    return ", ".join(rows)\n\n\n'
                         'if __name__ == "__main__":\n    print(render(sys.argv[1:]))\n'),
    # A FIXTURE TREE with no cases/ runner: a script beside it reads it by a joined path, its --lang flag selects
    'tests/fast.py': ('#!/usr/bin/env python3\n"""tests/fast.py [--lang python|java]"""\nimport os, sys\n'
                      'HERE = os.path.dirname(os.path.abspath(__file__))\nFP = os.path.join(HERE, "fastcases")\n\n\n'
                      'if __name__ == "__main__":\n    print(sorted(os.listdir(FP)))\n'),
    'tests/fastcases/python/shop/orders.py': 'def total(xs):\n    return sum(xs)\n',
    'tests/fastcases/python/shop/test_orders.py': 'from shop.orders import total\n\n\ndef test_total():\n    assert total([1]) == 1\n',
    # goldens a pytest test opens by path; the second golden is read by nothing
    'tests/test_report.py': ('import os\nHERE = os.path.dirname(os.path.abspath(__file__))\n\n\n'
                             'def test_report():\n    assert open(os.path.join(HERE, "golden", "report.expected")).read()\n'),
    'tests/golden/report.expected': 'total: 1\n',
    'tests/golden/other.expected': 'total: 2\n',
    # a data file whose name other files share, and one whose name is its own
    'conf/a/settings.json': '{"a": 1}\n',
    'conf/b/settings.json': '{"b": 1}\n',
    'conf/unique_rules.json': '{"r": 1}\n',
    'tests/test_conf.py': ('import json\n\n\ndef test_conf():\n    assert json.load(open("conf/unique_rules.json"))\n'
                           '    assert "settings.json"\n'),
    'tests/smoke.py': ('import os, subprocess, sys\nROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))\n'
                       'CLI = os.path.join(ROOT, "tools", "cli")\n'
                       'out = subprocess.run(["bash", CLI, "report", "a", "b"], capture_output=True, text=True).stdout\n'
                       'sys.exit(0 if out.strip() == "a, b" else 1)\n'),
}

# (why, {file: (old, new)}, extra args, wanted substrings, unwanted substrings)
SCENARIOS = [
    ('python case data', {'tests/cases/python/alpha/app/pricing.py': ('1.2', '1.25'),
                          'tests/cases/python/alpha/tests/test_pricing.py': ('== 12', '== 12.5')}, [],
     ['python3 tests/run.py alpha --lang python'],
     ['pytest tests/cases', 'tests/cases/python/beta', 'no test in the graph reaches', 'tests/notes.py', 'python tests/cases']),
    ('engine rule and golden (python)', {'graph/python/engine/rules.dl': ('edge(', 'edges('),
                                         'graph/test/python/expected/01-x.edges': ('main', 'main2')}, [],
     ['bash graph/test/python/run-tests.sh\n'],
     ['no test names', 'run-tests.sh 01-x', 'graph/test/java', 'graph/test/csharp']),
    ('engine case source (python), one case', {'graph/test/python/cases/01-x/src/main.py': ('return 1', 'return 2')}, [],
     ['bash graph/test/python/run-tests.sh 01-x'],
     ['python graph/test/python/cases', 'pytest graph/test']),
    ('java case data and rule', {'tests/cases/java/gamma/src/A.java': ('return 1', 'return 2'),
                                 'graph/java/engine/rules.dl': ('edge(', 'edges(')}, [],
     ['python3 tests/run.py gamma --lang java', 'bash graph/test/java/run-tests.sh'],
     ['no test names', 'graph/test/python/run-tests.sh', 'pytest']),
    ('csharp case data, runner flag from its usage', {'tests/cases/csharp/delta/A.cs': ('return 1', 'return 2'),
                                                      'graph/test/csharp/cases/01-y/src/B.cs': ('class B {}', 'class B { }')}, [],
     ['python3 tests/run.py delta --lang csharp', 'bash graph/test/csharp/run-tests.sh --only 01-y'],
     ['no test names', 'pytest']),
    ('control: real code next to case data keeps pytest', {'app/core.py': ('x + 1', 'x + 2')}, [],
     ['pytest tests/test_real.py'],
     ['tests/run.py', 'tests/cases/python/alpha/tests/test_pricing.py', 'case data and rules']),
    ('fixture tree read by a script beside it', {'tests/fastcases/python/shop/orders.py': ('sum(xs)', 'sum(xs) + 0'),
                                                'tests/fastcases/python/shop/test_orders.py': ('== 1', '== 1.0')}, [],
     ['case data for tests/fast.py', 'python3 tests/fast.py --lang python'],
     ['pytest tests/fastcases', 'edited test file', 'BY PACKAGE', 'BY NAME']),
    ('golden read by a test, by path', {'tests/golden/report.expected': ('total: 1', 'total: 1.0')}, [],
     ['case data for tests/test_report.py', 'pytest tests/test_report.py'],
     ['[text]']),
    ('control: a golden no test reads is not given its neighbour\'s test', {'tests/golden/other.expected': ('total: 2', 'total: 3')}, [],
     ['case data for tests/run.py (a runner by its name; it does not name this path)'],
     ['pytest tests/test_report.py']),
    ('control: editing the test that reads the golden runs that test', {'tests/test_report.py': ('.read()', '.read().strip()')}, [],
     ['pytest tests/test_report.py'],
     ['case data']),
    ('case.json maps to its case, never to the files that write some case.json', {'tests/cases/python/alpha/case.json': ('[]', '[ ]')}, [],
     ['python3 tests/run.py alpha --lang python'],
     ["named as 'case.json'", 'tests/notes.py', 'tests/smoke.py']),
    ('a data file\'s shared name is no test-name match', {'conf/a/settings.json': ('1', '2')}, [],
     [],
     ["named as 'settings.json'", 'pytest tests/test_conf.py']),
    ('control: a data file named by its own unique path keeps its test', {'conf/unique_rules.json': ('1', '2')}, [],
     ['tests/test_conf.py'],
     ['case data']),
    ('a program started through its dispatcher', {'tools/cli-report.py': ('", ".join', '" , ".join')}, [],
     ['tests/smoke.py'],
     ['no test names']),
]


def sh(cwd, *cmd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def main():
    fails = []
    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok else '\n     ' + detail.strip().replace('\n', '\n     ')))
        if not ok: fails.append(why)

    env = dict(os.environ, AXIOMCODE_ENGINE=ROOT, AXIOMCODE_NO_REFRESH='1')
    work = tempfile.mkdtemp(prefix='axiomcode-case-runner-')
    try:
        repo = os.path.join(work, 'repo')
        for rel, text in FILES.items():
            p = os.path.join(repo, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, 'w').write(text)
        for rel in ('tools/cli', 'tools/cli-report.py', 'tests/run.py', 'tests/fast.py'):
            os.chmod(os.path.join(repo, rel), 0o755)
        for cmd in (('git', 'init', '-q'), ('git', 'add', '-A'),
                    ('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')):
            sh(repo, *cmd)
        built = sh(repo, AX, 'index', '.', '--lang', 'python', env=env)
        check(built.returncode == 0, 'the fixture indexes', built.stdout + built.stderr)
        n_ok = 0
        for why, edits, extra, want, avoid in SCENARIOS:
            sh(repo, 'git', 'checkout', '-q', '--', '.')
            for rel, (old, new) in edits.items():
                p = os.path.join(repo, rel); t = open(p).read()
                check(old in t, f'{why}: the edit applies to {rel}'); open(p, 'w').write(t.replace(old, new, 1))
            r = sh(repo, DISP, 'test-impact', '.', *extra, env=env)
            out = r.stdout + r.stderr
            check(r.returncode == 0 and 'Traceback' not in out, f'{why}: test-impact answers', out)
            for w in want: check(w in out, f'{why}: names {w.strip()!r}', out)
            for a in avoid: check(a not in out, f'{why}: does not name {a.strip()!r}', out)
            n_ok += 1
        # changed: a new file inside a fixture tree is case data for its runner, not 'a test file: run it'
        sh(repo, 'git', 'checkout', '-q', '--', '.')
        p = os.path.join(repo, 'tests', 'fastcases', 'python', 'shop', 'test_new.py')
        open(p, 'w').write('def test_new():\n    assert 1\n')
        r = sh(repo, DISP, 'changed', '.', env=env)
        out = r.stdout + r.stderr
        check('case data read by tests/fast.py' in out and 'a test file: run it' not in out,
              'changed: a new file in a fixture tree is case data for its runner', out)
        os.remove(p)
        p = os.path.join(repo, 'tests', 'test_added.py')
        open(p, 'w').write('def test_added():\n    assert 1\n')
        r = sh(repo, DISP, 'changed', '.', env=env)
        out = r.stdout + r.stderr
        check('a test file: run it' in out and 'case data' not in out, 'control: changed: a new real test file is a test to run', out)
        os.remove(p)
        # impact's tests line: 0 tests call it, and the suite that starts it as a subprocess is named
        sh(repo, 'git', 'checkout', '-q', '--', '.')
        r = sh(repo, AX, 'impact', 'tools/cli-report.py:5', env=env)
        out = r.stdout + r.stderr
        check('tests: 0 of' in out and 'NOT COUNTED: tools/cli-report.py runs as a program' in out and 'tests/smoke.py' in out,
              'impact names the test that starts the program through its dispatcher', out)
        r = sh(repo, AX, 'impact', 'app/core.py:1', env=env)
        out = r.stdout + r.stderr
        check('NOT COUNTED' not in out and 'tests: 1 of' in out, 'control: a function a test calls is counted, with no subprocess note', out)
        check(n_ok == len(SCENARIOS) and n_ok >= 1, f'{n_ok} scenario(s) ran')
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'ok' if not fails else f'{len(fails)} FAILED'}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
