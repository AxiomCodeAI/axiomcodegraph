#!/usr/bin/env python3
"""tests/changed_range.py — what `changed` and `test-impact` answer about a BRANCH, a new file, a copy without git, and a
changed file no graph reads.

Each behaviour has a near-miss control that must keep today's answer:

  --range a..b after a moved     only b's own commits (read from the merge-base), and a note saying a moved
      control                    a range whose base IS an ancestor: the same answer, and no note
  a clean tree over commits      "no change", then the --range that holds them
      control                    on the base branch itself: no suggestion
  a new module                   one `added <file>` line; no docstring word, no parameter, nothing at line 1
      control                    a function added to an existing file keeps its own line
  a copy without git             a refusal naming what to pass, not invented "added" declarations
      control                    the same copy with a named file: every declaration in it counts, and its tests are named
  a changed fixture              named as outside the index, with the test file that names it
      control                    a data file no test names: said so, never "no change"

Each run builds a real graph in a throwaway git repository (Python, so the rules compile once and are cached).

    python3 tests/changed_range.py
"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'bin', 'axiomcode')

FILES = {
    'app/__init__.py': '',
    'app/pricing.py': 'def price(q):\n    return q * 2\n\n\ndef discount(q):\n    return q - 1\n',
    'app/stock.py': 'def level(n):\n    return n\n',
    'tests/__init__.py': '',
    'tests/test_pricing.py': ('from app.pricing import price, discount\n\n\ndef test_price():\n    assert price(2) == 4\n\n\n'
                              'def test_discount():\n    assert discount(2) == 1\n'),
    'tests/test_stock.py': 'from app.stock import level\n\n\ndef test_level():\n    assert level(1) == 1\n',
    'tests/test_cases.py': ("import json, os\nHERE = os.path.dirname(__file__)\n\n\ndef test_cases():\n"
                            "    for c in os.listdir(os.path.join(HERE, 'cases')):\n"
                            "        json.load(open(os.path.join(HERE, 'cases', c, 'case.json')))\n"),
    'tests/cases/one/case.json': '{"q": 1}\n',
    'data/lookup.csv': 'a,1\n',
}
# a new module whose docstrings hold words a line-by-line reading took for methods (`works (…)`, `side(effect)`)
NEWMOD = '''"""New module.

It works (see below): import it, and
side(effects) happen.
"""
from app.pricing import price


def total(a, b):
    """total works
    side(effect)
    """
    return price(a) + b


def unused(x, y, z):
    return x
'''


def sh(cwd, *cmd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def main():
    fails = []
    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok else '\n     ' + detail.strip().replace('\n', '\n     ')))
        if not ok: fails.append(why)

    work = tempfile.mkdtemp(prefix='axiomcode-changed-range-')
    env = dict(os.environ, AXIOMCODE_ENGINE=ROOT)
    G = ('git', '-c', 'user.email=t@t', '-c', 'user.name=t')
    def write(repo, rel, text):
        p = os.path.join(repo, rel); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'w').write(text)
    def ax(repo, *a):
        r = sh(repo, AX, *a, env=env); return r.returncode, r.stdout + r.stderr
    try:
        repo = os.path.join(work, 'repo'); os.makedirs(repo)
        for rel, text in FILES.items(): write(repo, rel, text)
        write(repo, '.gitignore', '.axiomcode/\n')
        sh(repo, 'git', 'init', '-q', '-b', 'main'); sh(repo, 'git', 'add', '-A'); sh(repo, *G, 'commit', '-qm', 'base')
        built = sh(repo, AX, 'index', '.', '--lang', 'python', env=env)
        check(built.returncode == 0, 'the graph builds', built.stdout + built.stderr)

        # the branch: a body edit to discount, a new module with its test, a fixture edit
        sh(repo, 'git', 'checkout', '-qb', 'feature')
        write(repo, 'app/pricing.py', FILES['app/pricing.py'].replace('q - 1', 'q - 2'))
        write(repo, 'app/newmod.py', NEWMOD)
        write(repo, 'tests/test_newmod.py', 'from app.newmod import total\n\n\ndef test_total():\n    assert total(1, 1) == 3\n')
        write(repo, 'tests/cases/one/case.json', '{"q": 2}\n')
        sh(repo, 'git', 'add', '-A'); sh(repo, *G, 'commit', '-qm', 'feature')
        # the base branch moves on: an unrelated change to stock.py
        sh(repo, 'git', 'checkout', '-q', 'main')
        write(repo, 'app/stock.py', 'def level(n):\n    return n + 1\n')
        sh(repo, 'git', 'add', '-A'); sh(repo, *G, 'commit', '-qm', 'upstream')
        sh(repo, 'git', 'checkout', '-q', 'feature')

        rc, out = ax(repo, 'changed', '.', '--range', 'main..feature')
        check(rc == 0 and 'Traceback' not in out, 'changed --range answers', out)
        check('range base: merge-base' in out and 'main has moved 1 commit' in out, 'a moved base is named: the answer reads from the merge-base', out)
        check('app/stock.py' not in out, "upstream's stock.py is not reported as the branch's change", out)
        check('discount' in out, "the branch's own body edit is reported", out)
        check('added      app/newmod.py' in out and 'new file, 2 declaration(s)' in out, 'a new module is one added line', out)
        rows = [l.split() for l in out.split('\n') if l.startswith('  ') and len(l.split()) >= 2]
        for word in ('works', 'side', 'import', 'It', 'unused', 'a', 'b', 'x'):
            check(not any(r[1] == word or r[1].endswith('.' + word) for r in rows), f"no docstring word, unreferenced function or parameter listed from the new module ({word!r})", out)
        check('app/newmod.py:1 ' not in out, 'nothing from the new module at line 1', out)
        check('total   app/newmod.py:9' in out, 'a new declaration already called from outside its file is listed at its own line', out)
        check('outside every indexed language' in out and 'tests/cases/one/case.json' in out, 'the changed fixture is named, not dropped', out)

        rc, out = ax(repo, 'test-impact', '.', '--range', 'main..feature')
        check(rc == 0 and 'tests/test_pricing.py' in out, 'test-impact --range selects the tests of the branch edit', out)
        check('test_stock' not in out, "test-impact --range does not select the tests of upstream's commit", out)
        check('tests/test_newmod.py' in out, 'a new test file is itself a test to run', out)
        check("named as 'case.json' by: tests/test_cases.py" in out, 'the test that loads the changed fixture is named', out)
        check('page 1 of' not in out, 'no page footer', out)

        # control: a range whose base is an ancestor keeps its answer and gets no note
        rc, out = ax(repo, 'changed', '.', '--range', 'feature~1..feature')
        check(rc == 0 and 'range base' not in out and 'discount' in out, 'control: an ancestor range has no merge-base note', out)

        # a clean tree whose work is committed: suggest the range
        rc, out = ax(repo, 'changed', '.')
        check('no change' in out and '--range main..HEAD' in out, 'a clean tree over committed work names the range to ask', out)
        rc, out = ax(repo, 'test-impact', '.')
        check('test-impact --range main..HEAD' in out, 'test-impact on a clean tree names the range to ask', out)
        # control: on main itself there is nothing of its own to suggest
        sh(repo, 'git', 'checkout', '-q', 'main')
        rc, out = ax(repo, 'changed', '.')
        check('no change' in out and '--range' not in out, 'control: the base branch gets no range suggestion', out)
        # control: a function ADDED to an existing file keeps its own line
        write(repo, 'app/stock.py', 'def level(n):\n    return n + 1\n\n\ndef restock(n):\n    return n\n')
        rc, out = ax(repo, 'changed', '.')
        check('restock   app/stock.py:5' in out, 'control: an added function in an existing file is at its own line', out)
        sh(repo, 'git', 'checkout', '-q', '--', '.')
        # control: a data file no test names is said to be unnamed, never "no change"
        write(repo, 'data/lookup.csv', 'a,2\n')
        rc, out = ax(repo, 'test-impact', '.')
        check('data/lookup.csv' in out and 'no test names data/lookup.csv' in out, 'control: an unnamed data file is reported as unnamed', out)
        check('no changed declaration the graph can name' not in out, "control: it does not read as 'nothing to test'", out)
        sh(repo, 'git', 'checkout', '-q', '--', '.')

        # a copy without git
        copy = os.path.join(work, 'copy')
        shutil.copytree(repo, copy, ignore=shutil.ignore_patterns('.git', '.axiomcode'))
        built = sh(copy, AX, 'index', '.', '--lang', 'python', env=env)
        check(built.returncode == 0, 'the copy builds', built.stdout + built.stderr)
        write(copy, 'app/pricing.py', FILES['app/pricing.py'].replace('q * 2', 'q * 3'))
        rc, out = ax(copy, 'changed', '.')
        check(rc != 0 and 'no git base' in out and 'added' not in out, 'no git: changed refuses, naming what to pass', out)
        rc, out = ax(copy, 'test-impact', '.')
        check(rc != 0 and 'no git base' in out and 'page 1 of' not in out, 'no git: test-impact refuses, with no page footer', out)
        rc, out = ax(copy, 'test-impact', '.', 'app/pricing.py')
        check(rc == 0 and 'tests/test_pricing.py' in out and 'test_stock' not in out, 'control: test-impact <file> on the copy names that file\'s tests', out)
        rc, out = ax(copy, 'changed', '.', 'app/pricing.py')
        check('named' in out and 'price' in out and 'discount' in out, 'control: changed <file> on the copy counts its declarations', out)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'ok' if not fails else f'{len(fails)} FAILED'}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
