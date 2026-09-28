#!/usr/bin/env python3
"""tests/script_tests.py — test-impact selects a script-style runner, with the command the project runs it by (T2-1).

A runner under the test tree that calls no test framework — `test/run.js` calling `runCase(...)` at top level, a
`tests/check.py` with its own main guard — was walked to and labelled [test] by impact, then counted "0 of 0", and
test-impact said no test reaches the change. Each run copies the golden fixture into a throwaway git repository,
indexes it, edits the changed function's body and asks test-impact what to run. The script is selected with its own
command (the package script that names it, or the interpreter) and a framework test beside it keeps its command.

    python3 tests/script_tests.py
"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'bin', 'axiomcode')
CASES = os.path.join(ROOT, 'tests', 'cases')


def sh(cwd, *cmd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def main():
    fails = []
    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok else '\n     ' + detail.strip().replace('\n', '\n     ')))
        if not ok: fails.append(why)

    env = dict(os.environ, AXIOMCODE_ENGINE=ROOT, AXIOMCODE_NO_REFRESH='1')
    # (language, fixture, --src, file to edit, old text, new text, wanted lines, unwanted lines)
    runs = [
        ('javascript', 'script-runner-is-a-test', 'src', 'src/lib/text.js', 'trim().toLowerCase()', 'trim().toLowerCase().normalize()',
         ['src/test/run.js', '(cd src && npm run test)', 'node src/test/smoke.js', '(cd src && npx vitest run test/text.test.js)'],
         ['no test in the graph reaches', 'src/test/helpers.js']),
        ('python', 'script-runner-is-a-test', '.', 'app/pricing.py', 'amount * 1.2', 'amount * 1.25',
         ['tests/check_prices.py', 'python tests/check_prices.py', 'pytest tests/test_discount.py'],
         ['no test in the graph reaches', 'tests/fixtures/server.py', 'pytest tests/check_prices.py']),
    ]
    for lang, case, src, rel, old, new, want, avoid in runs:
        work = tempfile.mkdtemp(prefix='axiomcode-script-tests-')
        try:
            repo = os.path.join(work, 'repo')
            shutil.copytree(os.path.join(CASES, lang, case), repo, ignore=shutil.ignore_patterns('.axiomcode', 'case.json'))
            for cmd in (('git', 'init', '-q'), ('git', 'add', '-A'),
                        ('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')):
                sh(repo, *cmd)
            built = sh(repo, AX, 'index', '.', '--lang', lang, '--src', src, env=env)
            check(built.returncode == 0, f'{lang}: the fixture indexes', built.stdout + built.stderr)
            f = os.path.join(repo, rel); text = open(f).read()
            open(f, 'w').write(text.replace(old, new))
            r = sh(repo, AX, 'test-impact', '.', env=env)
            out = r.stdout + r.stderr
            check(r.returncode == 0 and 'Traceback' not in out, f'{lang}: test-impact answers', out)
            for w in want: check(w in out, f'{lang}: test-impact names {w!r}', out)
            for a in avoid: check(a not in out, f'{lang}: test-impact does not name {a!r}', out)
        finally:
            shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'ok' if not fails else f'{len(fails)} FAILED'}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
