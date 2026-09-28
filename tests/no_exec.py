#!/usr/bin/env python3
"""tests/no_exec.py: the query verbs answer where os.exec* does not replace the process, as on Windows (#1640).

On Windows os.execv / os.execvp start the program as a NEW process and end the caller at once with status 0. The
dispatcher runs `impact`, `path` and `context` through ax_fresh.py, which handed over to the verb with os.execvp, so
on Windows every one of them exited 0 with no output: bash had its status before the verb wrote a line. Every other
platform passed, because there exec replaces the process. The Windows behaviour is reproduced here on any OS: a
sitecustomize on PYTHONPATH makes every os.exec* start the program with its output going nowhere and exit 0 at once,
and puts ax_exec on its Windows branch (run the program, exit with its status).

Checks, each against the control of the same question asked normally:
  impact, impact --json, path, context through the dispatcher answer as they do without the emulation
  a refusal (a name the graph does not hold) keeps its non-zero status
  ax_langs.py on a repository with one graph (its own hand-over) answers
  no script or hook calls os.exec* / os.spawn* except ax_exec.py

Indexes one case, so it needs the engine (AXIOMCODE_ENGINE, as tests/run.py).

    python3 tests/no_exec.py
"""
import os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
HOOKS = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks')
CASE = os.path.join(ROOT, 'tests', 'cases', 'java', 'impact-answer-in-pages', 'src')
# os.exec* as the Windows C runtime does it: the program starts as another process, whose answer reaches nobody who
# waits on this one, and this process ends now with status 0
WINDOWS_EXEC = '''import os, subprocess, sys
def _leave(path, args, *env):
    subprocess.Popen(list(args), executable=path if os.sep in path else None, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os._exit(0)
for _n in ('execv', 'execve', 'execvp', 'execvpe'):
    setattr(os, _n, _leave)
for _n in ('execl', 'execle', 'execlp', 'execlpe'):
    setattr(os, _n, lambda path, *args: _leave(path, args))
sys.path.insert(0, %r)
try:
    import ax_exec; ax_exec.REPLACES = False
except ImportError:
    pass
finally:
    sys.path.pop(0)
'''


def run(argv, repo, env):
    p = subprocess.run(argv, cwd=repo, env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, p.stdout + p.stderr


def main():
    bad = 0
    # the static half: a new os.exec* anywhere a verb or a hook runs would bring the bug back
    pat = re.compile(r'\bos\.(exec[lv]p?e?|spawn[lv]p?e?)\s*\(')
    for d in (SCRIPTS, HOOKS):
        for n in sorted(os.listdir(d)):
            f = os.path.join(d, n)
            if n == 'ax_exec.py' or not os.path.isfile(f): continue
            try: first = open(f, encoding='utf-8').readline()
            except (UnicodeDecodeError, OSError): continue
            if not (n.endswith('.py') or 'python' in first): continue
            for i, line in enumerate(open(f, encoding='utf-8'), 1):
                if pat.search(line):
                    bad += 1; print(f'FAIL {os.path.relpath(f, ROOT)}:{i} hands over with os.exec*/os.spawn*; use ax_exec.become')
    if not bad: print('ok   no script or hook calls os.exec* or os.spawn* but ax_exec.py')

    work = tempfile.mkdtemp(prefix='axiomcode-noexec-')
    try:
        repo = os.path.join(work, 'repo'); shutil.copytree(CASE, repo)
        subprocess.run(['git', 'init', '-q', '.'], cwd=repo, check=True)
        subprocess.run(['git', 'add', '-A'], cwd=repo, check=True)
        subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x'], cwd=repo, check=True)
        r = subprocess.run(['bash', os.path.join(SCRIPTS, 'axiomcode-build'), repo], capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            print('no_exec: index failed\n' + (r.stdout + r.stderr)[-1500:]); return 1
        site = os.path.join(work, 'site'); os.makedirs(site)
        open(os.path.join(site, 'sitecustomize.py'), 'w').write(WINDOWS_EXEC % SCRIPTS)
        plain = dict(os.environ)
        win = dict(plain, PYTHONPATH=site + os.pathsep + os.environ.get('PYTHONPATH', ''))
        ax = ['bash', os.path.join(SCRIPTS, 'axiomcode')]
        checks = [  # (why, argv, what the answer holds, exit status 0?)
            ('impact answers', ax + ['impact', 'Rates.rate', repo], 'Quote.total', True),
            ('impact --json answers', ax + ['impact', 'Rates.rate', repo, '--json'], '"Quote.total', True),
            ('path answers', ax + ['path', 'Quote.total', 'Rates.rate', repo], 'reached', True),
            ('context answers', ax + ['context', 'rate', repo], 'rate', True),
            ('a refusal keeps its non-zero status', ax + ['impact', 'NoSuchName.nowhere', repo], 'NoSuchName', False),
            ('ax_langs.py with one graph answers', [sys.executable, os.path.join(SCRIPTS, 'ax_langs.py'), repo, 'axiomcode-impact', 'Rates.rate', repo], 'Quote.total', True),
        ]
        for why, argv, want, zero in checks:
            c_rc, c_out = run(argv, repo, plain)
            w_rc, w_out = run(argv, repo, win)
            control = want in c_out and (c_rc == 0) == zero
            ok = control and want in w_out and w_rc == c_rc and 'Traceback' not in w_out
            print(('ok   ' if ok else 'FAIL ') + why + ' where exec does not replace the process')
            if not ok:
                bad += 1
                if not control: print(f'     the control itself did not answer (rc={c_rc}): ' + c_out[-600:].replace('\n', '\n     '))
                print(f'     rc={w_rc} (control {c_rc}): ' + (w_out[-800:] or '<no output at all>').replace('\n', '\n     '))
        print(f"{len(checks) + 1} of {len(checks) + 1} check(s) held" if not bad else f"{bad} FAILED")
        return 1 if bad else 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
