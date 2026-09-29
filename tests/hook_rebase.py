#!/usr/bin/env python3
"""tests/hook_rebase.py: after a rebase, a pull or a checkout, an edit report names only what that edit changed.

The edit hook read the edited file against the baseline (the commit the graph was built from), which moves only when the
background refresher has rebuilt HEAD's text: minutes on a real tree, never with refresh off. So after `git rebase` every
change the new commits made to the file came back as "this edit changed", with signature diffs garbled by the graph's
lines landing on another text, and `changed` counted the new commits as the agent's own. Checked here with the refresher
off, which is the moment between the rebase and the refresh:

  a rebase brings upstream edits, then one local edit    only the local edit is reported, the base move is said once,
                                                          and `changed` reads against the new HEAD
      control                                             an edit before any move says nothing about a base
  a real multi-line local edit (a Write, no host payload) the signature and the body it changed are both reported
  a checkout to another branch, then an edit              only that edit, and the move is said
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

def edit(repo, sid, rel, old, new, payload=True):
    """an Edit as the host runs it: PreToolUse, the change, PostToolUse (with the host's originalFile when `payload`)"""
    p = os.path.join(repo, rel); inp = dict(file_path=p, old_string=old, new_string=new)
    fire(repo, sid, 'changes.py', 'PreToolUse', 'Edit', inp)
    before = open(p).read(); assert before.count(old) == 1, old
    open(p, 'w').write(before.replace(old, new, 1))
    return fire(repo, sid, 'enrich.py', 'PostToolUse', 'Edit', inp,
                dict(filePath=p, oldString=old, newString=new, originalFile=before) if payload else None)

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

        # control: an edit before anything moved says nothing about a base
        out = edit(repo, 's0', 'app/eng.py', 'return x\n', 'return x - 0\n')
        check('stop' in out and 'base moved' not in out, 'control: an edit with HEAD unmoved reports it and names no base move', out)
        sh(repo, 'git', 'checkout', '-q', '--', 'app/eng.py')

        # upstream moves on (through the remote; the local main is never updated), and feature is rebased onto it
        up = os.path.join(work, 'up'); sh(work, 'git', 'clone', '-q', origin, up)
        write(up, 'app/eng.py', UPSTREAM); commit(up, 'upstream'); sh(up, 'git', 'push', '-q', 'origin', 'main')
        sh(repo, 'git', 'fetch', '-q', 'origin')
        r = sh(repo, 'git', 'rebase', 'origin/main')
        check(r.returncode == 0, 'the branch rebases onto the moved remote', r.stderr)

        # one local edit, to run's body
        out = edit(repo, 's1', 'app/eng.py', 'y = x + 1', 'y = x + 5')
        check('body edit of run:' in out, 'after a rebase, the local edit to run is reported', out)
        check('_engine_hash' not in out and 'helper' not in out, "upstream's _engine_hash and helper are not reported as this edit", out)
        check(out.count('the base moved') == 1 and '1 commit(s)' in out, 'the base move is said once, with the upstream commit count', out)
        out2 = edit(repo, 's1', 'app/eng.py', 'return x\n', 'return x * 1\n')
        check('stop' in out2 and 'base moved' not in out2, 'the next edit reports itself and does not repeat the base move', out2)
        rc = sh(repo, AX, 'changed', '.')
        check('run' in rc.stdout and 'stop' in rc.stdout and '_engine_hash' not in rc.stdout and 'helper' not in rc.stdout,
              '`changed` after the rebase lists the uncommitted edits only, not what upstream changed', rc.stdout + rc.stderr)
        check('the base moved' in rc.stdout, '`changed` says the base moved', rc.stdout)
        # the same edit with no host payload: the before-text comes from the PreToolUse snapshot
        out3 = edit(repo, 's1b', 'app/eng.py', 'y = x + 5', 'y = x + 6', payload=False)
        check('run' in out3 and '_engine_hash' not in out3 and 'helper' not in out3, 'without the host payload, the PreToolUse snapshot keeps the report to this edit', out3)
        sh(repo, 'git', 'checkout', '-q', '--', 'app/eng.py')

        # a real multi-line local edit, written whole with no host payload: a signature and a body, both reported
        p = os.path.join(repo, 'app/eng.py'); cur = open(p).read()
        new = cur.replace('_engine_hash(a, b, c=0)', '_engine_hash(a, b, c=0, d=1)').replace('a + b + c', 'a + b + c + d').replace('y = x + 1', 'y = x + 7')
        inp = dict(file_path=p, content=new)
        pre = fire(repo, 's2', 'changes.py', 'PreToolUse', 'Write', inp); open(p, 'w').write(new)
        out = fire(repo, 's2', 'enrich.py', 'PostToolUse', 'Write', inp)
        check('signature _engine_hash' in pre and '+d' in pre and 'helper' not in pre,
              'a multi-line local edit: the signature it changes is reported before it lands, with the parameter, and nothing upstream did', pre)
        check('run' in out and 'helper' not in out, 'a multi-line local edit: the body it changed is reported, and nothing upstream did', out)
        sh(repo, 'git', 'checkout', '-q', '--', 'app/eng.py')

        # a checkout to another branch, then an edit (no host payload, no PreToolUse: the edit is undone to find the before)
        sh(repo, 'git', 'checkout', '-qb', 'side', 'main')
        write(repo, 'app/eng.py', ENG + '\n\ndef side(z):\n    return z\n'); commit(repo, 'side')
        p = os.path.join(repo, 'app/eng.py'); before = open(p).read(); open(p, 'w').write(before.replace('return x\n', 'return x + 2\n'))
        out = fire(repo, 's3', 'enrich.py', 'PostToolUse', 'Edit', dict(file_path=p, old_string='return x\n', new_string='return x + 2\n'))
        check('body edit of stop:' in out and '_engine_hash' not in out and 'side' not in out.replace('checkout', ''),
              'after a checkout, only the edit to stop is reported, not what the other branch holds', out)
        check(out.count('the base moved') == 1, 'the checkout is said once as a base move', out)
        sh(repo, 'git', 'checkout', '-q', '--', 'app/eng.py'); sh(repo, 'git', 'checkout', '-q', 'feature')

        # `changed --range`: the local main is behind origin/main, which feature was rebased onto
        rc = sh(repo, AX, 'changed', '.', '--range', 'main..HEAD')
        check('other' in rc.stdout and '_engine_hash' not in rc.stdout and 'helper' not in rc.stdout,
              "--range main..HEAD, main left behind origin/main: only the branch's own commit", rc.stdout + rc.stderr)
        check('main is behind origin/main' in rc.stdout, 'the note says which fork it read from and why', rc.stdout)
        base = sh(repo, 'git', 'rev-parse', 'main').stdout.strip()
        rc = sh(repo, AX, 'changed', '.', '--range', f'{base}..HEAD')
        check('other' in rc.stdout and ('_engine_hash' in rc.stdout or 'helper' in rc.stdout) and 'behind' not in rc.stdout,
              'control: an explicit commit range is read as written, upstream commit included', rc.stdout + rc.stderr)
        rc = sh(repo, AX, 'changed', '.', '--range', 'origin/main..HEAD')
        check('other' in rc.stdout and '_engine_hash' not in rc.stdout and 'range base' not in rc.stdout,
              'control: a range from the up-to-date remote needs no note', rc.stdout + rc.stderr)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"\n{'ok' if not fails else f'{len(fails)} FAILED'}")
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
