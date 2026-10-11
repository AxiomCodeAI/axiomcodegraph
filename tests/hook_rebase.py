#!/usr/bin/env python3
"""tests/hook_rebase.py: after a rebase or a checkout, `changed` and the pre-edit report name only what the edits changed.

The edit hook read the edited file against the baseline (the commit the graph was built from), which moves only when the
background refresher has rebuilt HEAD's text: minutes on a real tree, never with refresh off. So after `git rebase` every
change the new commits made to the file came back as "this edit changed", with signature diffs garbled by the graph's
lines landing on another text, and `changed` counted the new commits as the agent's own. Checked here with the refresher
off, which is the moment between the rebase and the refresh:

  a rebase brings upstream edits, then local edits       `changed` lists the local edits only and says the base moved
  a real multi-line local edit (a Write)                  the signature it changes is reported before it lands
                                                          (changes.py), with nothing upstream did
  `changed --range`                                        a local branch left behind the remote it was rebased onto
                                                          reads from the remote's fork, with a note
      control                                             an explicit commit range is read exactly as written

It indexes a small Python project, so it needs the engine.

    python3 tests/hook_rebase.py
"""
import json, os, shutil, subprocess, sys, tempfile

os.environ['TMPDIR'] = tempfile.mkdtemp(prefix='ax-hook-rebase-')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOKS = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks')
AX = os.path.join(ROOT, 'bin', 'axiomcode')
# `changed` is internal: the installed command routes only the public verbs, the dispatcher still serves it
DISPATCH = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')
ENV = dict(os.environ, AXIOMCODE_ENGINE=ROOT, AXIOMCODE_NO_REFRESH='1')
G = ('git', '-c', 'user.email=t@t', '-c', 'user.name=t')

ENG = ('def _engine_hash(a, b):\n    return a + b\n\n\n'
       'def run(x):\n    y = x + 1\n    return _engine_hash(y, 2)\n\n\n'
       'def stop(x):\n    return x\n')
UPSTREAM = ('import os\n\n\ndef helper():\n    return 1\n\n\n'
            + ENG.replace('_engine_hash(a, b)', '_engine_hash(a, b, c=0)').replace('a + b', 'a + b + c'))

fails = []
def check(ok, why, detail=''):
    print(('ok   ' if ok else 'FAIL ') + why + ('' if ok else '\n     ' + str(detail).strip().replace('\n', '\n     ')))
    if not ok: fails.append(why)

def sh(cwd, *a):
    return subprocess.run(a, cwd=cwd, capture_output=True, text=True, env=ENV)

def fire(repo, sid, hook, event, tool, inp, resp=None):
    ev = dict(hook_event_name=event, tool_name=tool, session_id=sid, cwd=repo, tool_input=inp)
    if resp is not None: ev['tool_response'] = resp
    r = subprocess.run([sys.executable, os.path.join(HOOKS, hook)], input=json.dumps(ev), capture_output=True, text=True, timeout=120, env=ENV)
    try: return json.loads(r.stdout)['hookSpecificOutput']['additionalContext']
    except Exception: return r.stdout + r.stderr

def edit(repo, rel, old, new):
    p = os.path.join(repo, rel); before = open(p).read(); assert before.count(old) == 1, old
    open(p, 'w').write(before.replace(old, new, 1))

def write(repo, rel, text):
    p = os.path.join(repo, rel); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'w').write(text)

def commit(repo, msg):
    sh(repo, 'git', 'add', '-A'); sh(repo, *G, 'commit', '-qm', msg)


def main():
    work = tempfile.mkdtemp(prefix='axiomcode-hook-rebase-')
    try:
        origin = os.path.join(work, 'origin.git'); repo = os.path.join(work, 'repo')
        sh(work, 'git', 'init', '-q', '--bare', '-b', 'main', origin)
        os.makedirs(repo)
        for rel, text in {'app/__init__.py': '', 'app/eng.py': ENG, 'app/other.py': 'def other(q):\n    return q\n',
                          'tests/__init__.py': '', 'tests/test_eng.py': 'from app.eng import run\n\n\ndef test_run():\n    assert run(1)\n',
                          '.gitignore': '.axiomcode/\n'}.items(): write(repo, rel, text)
        sh(repo, 'git', 'init', '-q', '-b', 'main'); commit(repo, 'base')
        sh(repo, 'git', 'remote', 'add', 'origin', origin); sh(repo, 'git', 'push', '-q', 'origin', 'main')
        sh(repo, 'git', 'fetch', '-q', 'origin')
        sh(repo, 'git', 'checkout', '-qb', 'feature', '--track', 'origin/main')
        write(repo, 'app/other.py', 'def other(q):\n    return q + 1\n'); commit(repo, 'mine')
        built = sh(repo, AX, 'index', '.', '--lang', 'python')
        check(built.returncode == 0 and os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')), 'the graph builds', built.stdout + built.stderr)

        # upstream moves on (through the remote; the local main is never updated), and feature is rebased onto it
        up = os.path.join(work, 'up'); sh(work, 'git', 'clone', '-q', origin, up)
        write(up, 'app/eng.py', UPSTREAM); commit(up, 'upstream'); sh(up, 'git', 'push', '-q', 'origin', 'main')
        sh(repo, 'git', 'fetch', '-q', 'origin')
        r = sh(repo, 'git', 'rebase', 'origin/main')
        check(r.returncode == 0, 'the branch rebases onto the moved remote', r.stderr)

        # two local edits, to run's body and to stop's
        edit(repo, 'app/eng.py', 'y = x + 1', 'y = x + 5')
        edit(repo, 'app/eng.py', 'return x\n', 'return x * 1\n')
        rc = sh(repo, 'bash', DISPATCH, 'changed', '.')
        check('run' in rc.stdout and 'stop' in rc.stdout and '_engine_hash' not in rc.stdout and 'helper' not in rc.stdout,
              '`changed` after the rebase lists the uncommitted edits only, not what upstream changed', rc.stdout + rc.stderr)
        check('the base moved' in rc.stdout, '`changed` says the base moved', rc.stdout)
        sh(repo, 'git', 'checkout', '-q', '--', 'app/eng.py')

        # a real multi-line local edit, written whole: the signature it changes is reported before it lands
        p = os.path.join(repo, 'app/eng.py'); cur = open(p).read()
        new = cur.replace('_engine_hash(a, b, c=0)', '_engine_hash(a, b, c=0, d=1)').replace('a + b + c', 'a + b + c + d').replace('y = x + 1', 'y = x + 7')
        inp = dict(file_path=p, content=new)
        pre = fire(repo, 's2', 'changes.py', 'PreToolUse', 'Write', inp)
        check('signature _engine_hash' in pre and '+d' in pre and 'helper' not in pre,
              'a multi-line local edit: the signature it changes is reported before it lands, with the parameter, and nothing upstream did', pre)

        # `changed --range`: the local main is behind origin/main, which feature was rebased onto
        rc = sh(repo, 'bash', DISPATCH, 'changed', '.', '--range', 'main..HEAD')
        check('other' in rc.stdout and '_engine_hash' not in rc.stdout and 'helper' not in rc.stdout,
              "--range main..HEAD, main left behind origin/main: only the branch's own commit", rc.stdout + rc.stderr)
        check('main is behind origin/main' in rc.stdout, 'the note says which fork it read from and why', rc.stdout)
        base = sh(repo, 'git', 'rev-parse', 'main').stdout.strip()
        rc = sh(repo, 'bash', DISPATCH, 'changed', '.', '--range', f'{base}..HEAD')
        check('other' in rc.stdout and ('_engine_hash' in rc.stdout or 'helper' in rc.stdout) and 'behind' not in rc.stdout,
              'control: an explicit commit range is read as written, upstream commit included', rc.stdout + rc.stderr)
        rc = sh(repo, 'bash', DISPATCH, 'changed', '.', '--range', 'origin/main..HEAD')
        check('other' in rc.stdout and '_engine_hash' not in rc.stdout and 'range base' not in rc.stdout,
              'control: a range from the up-to-date remote needs no note', rc.stdout + rc.stderr)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'ok' if not fails else f'{len(fails)} FAILED'}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
