#!/usr/bin/env python3
"""tests/no_symlink.py — impact and the Datalog path answer where os.symlink is refused.

On Windows a symlink needs a privilege an unelevated user does not hold, and os.symlink raises WinError 1314.
Both query programs stage their fact files by linking them into a scratch directory, so every `impact` (and
`test-impact`, `changed --impact`, the MCP tools and the hooks that call them) died with a traceback for an
ordinary user, while CI's elevated Windows runner passed. The refusal is reproduced here on any OS: a
sitecustomize on PYTHONPATH replaces os.symlink with one that raises exactly that error.

Indexes one case, so it needs the engine (AXIOMCODE_ENGINE, as tests/run.py).

    python3 tests/no_symlink.py
"""
import os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
CASE = os.path.join(ROOT, 'tests', 'cases', 'java', 'impact-answer-in-pages', 'src')
DENY = '''import os
def _deny(*a, **k):
    raise OSError(1314, 'A required privilege is not held by the client')
os.symlink = _deny
'''


def main():
    work = tempfile.mkdtemp(prefix='axiomcode-nosymlink-')
    try:
        repo = os.path.join(work, 'repo'); shutil.copytree(CASE, repo)
        subprocess.run(['git', 'init', '-q', '.'], cwd=repo, check=True)
        subprocess.run(['git', 'add', '-A'], cwd=repo, check=True)
        subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x'], cwd=repo, check=True)
        r = subprocess.run(['bash', os.path.join(SCRIPTS, 'axiomcode-build'), repo], capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            print('no_symlink: index failed\n' + (r.stdout + r.stderr)[-1500:]); return 1
        site = os.path.join(work, 'site'); os.makedirs(site)
        open(os.path.join(site, 'sitecustomize.py'), 'w').write(DENY)
        env = dict(os.environ, PYTHONPATH=site + os.pathsep + os.environ.get('PYTHONPATH', ''))
        checks = [
            ('impact answers where a symlink is refused', ['axiomcode-impact', 'Rates.rate', repo], {}, 'Quote.total'),
            ('the Datalog path answers where a symlink is refused', ['axiomcode-path', 'Quote.total', 'Rates.rate', repo], {'AXIOMCODE_DATALOG': '1'}, 'the chain is verified'),
        ]
        bad = 0
        for why, cmd, extra, want in checks:
            p = subprocess.run([sys.executable, os.path.join(SCRIPTS, cmd[0])] + cmd[1:], cwd=repo, env=dict(env, **extra),
                               capture_output=True, text=True, timeout=300)
            out = p.stdout + p.stderr
            ok = p.returncode == 0 and want in out and 'Traceback' not in out
            print(('ok   ' if ok else 'FAIL ') + why)
            if not ok: bad += 1; print('     ' + out[-800:].replace('\n', '\n     '))
        print(f"{len(checks) - bad} of {len(checks)} check(s) held" if not bad else f"{bad} FAILED")
        return 1 if bad else 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
