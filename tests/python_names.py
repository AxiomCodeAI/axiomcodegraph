#!/usr/bin/env python3
"""tests/python_names.py — the CLI and the hooks run on a machine whose Python is not called python3 (#1331).

A python.org install on Windows has python.exe and py.exe and no python3, and on a desktop Windows `python3` is
the Store placeholder, which is on PATH and exits 9009. Both are simulated here: a `python3` that exits 9009,
and a PATH with no python3 at all. `python` is a wrapper that records each call and runs this interpreter. The
launcher asks it for sys.executable and hands bash that file, so what the record shows is that `python` was the
one asked, and the placeholder records that it was never run past the probe that passes over it.

The real machine is Windows; this pins the resolution order and the hand-off to bash on any platform.
"""
import json, os, shutil, stat, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AXJS = os.path.join(ROOT, 'bin', 'axiomcode.js')
RUNJS = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks', 'run.js')
FRONT = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')

fails, checked = [], []
def check(why, cond, detail=''):
    checked.append(why)
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond:
        fails.append(why)


def script(path, text):
    with open(path, 'w') as f:
        f.write(text)
    os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


with tempfile.TemporaryDirectory() as tmp:
    log = os.path.join(tmp, 'python.log')
    stubs = os.path.join(tmp, 'stubs')          # placeholder python3 + recording python, ahead of the real PATH
    bare = os.path.join(tmp, 'bare')            # only the tools the front end needs, and no python3 at all
    os.makedirs(stubs); os.makedirs(bare)
    script(os.path.join(stubs, 'python3'), f'#!/bin/sh\necho "placeholder $*" >> "{log}"\necho "Python was not found" >&2\nexit 9009\n')
    python = f'#!/bin/sh\necho "$*" >> "{log}"\nexec "{sys.executable}" "$@"\n'
    script(os.path.join(stubs, 'python'), python)
    script(os.path.join(bare, 'python'), python)
    for tool in ('bash', 'sh', 'sed', 'awk', 'head', 'grep', 'tr', 'dirname', 'cat', 'env', 'node'):
        found = shutil.which(tool)
        if found: os.symlink(found, os.path.join(bare, tool))
    placeholder = dict(os.environ, PATH=stubs + os.pathsep + os.environ['PATH'])
    placeholder.pop('AXIOMCODE_PYTHON', None); placeholder.pop('AXIOMCODE_PYTHON_EXE', None)

    open(log, 'w').close()

    def calls():
        try:
            with open(log) as f: return f.read()
        finally:
            open(log, 'w').close()

    # the command npm links: bash's python3 is the placeholder until the launcher puts its own first
    r = subprocess.run(['node', AXJS, 'help', 'context'], env=placeholder, capture_output=True, text=True, timeout=60)
    check('`axiomcode help context` answers when python3 is the Store placeholder',
          r.returncode == 0 and 'context' in r.stdout and 'Python was not found' not in r.stderr,
          f'rc={r.returncode} err={r.stderr[-300:]}')
    c = calls()
    check('...and the Python bash ran is the one `python` named, not the placeholder',
          'import sys' in c and 'ast.get_docstring' not in c, c)

    # a hook: stdin reaches it, and its exit status comes back unchanged (exit 2 is how a hook blocks)
    ev = json.dumps({'tool_name': 'Grep', 'tool_input': {'pattern': 'f'}, 'cwd': tmp, 'session_id': 's1'})
    r = subprocess.run(['node', RUNJS, 'direct.py'], input=ev, env=placeholder, capture_output=True, text=True, timeout=60)
    check('a hook runs under `python` when python3 is the placeholder', r.returncode == 0 and 'import sys' in calls(),
          f'rc={r.returncode} err={r.stderr[-300:]}')
    r = subprocess.run(['node', RUNJS, 'no-such-hook.py'], input='{}', env=placeholder, capture_output=True, text=True, timeout=60)
    check("a hook's exit status is passed through, not replaced", r.returncode == 2, f'rc={r.returncode}')
    calls()

    # AXIOMCODE_PYTHON comes first, as it does for the MCP server
    chosen = os.path.join(tmp, 'mine')
    script(chosen, f'#!/bin/sh\necho "mine $*" >> "{log}"\nexec "{sys.executable}" "$@"\n')
    r = subprocess.run(['node', AXJS, 'help', 'context'], env=dict(placeholder, AXIOMCODE_PYTHON=chosen),
                       capture_output=True, text=True, timeout=60)
    check('AXIOMCODE_PYTHON is the Python bash runs', r.returncode == 0 and 'mine' in calls(), f'rc={r.returncode}')

    # no Python at all: a hook must never block a tool for want of one
    only_node = os.path.join(tmp, 'only-node'); os.makedirs(only_node)
    os.symlink(shutil.which('node'), os.path.join(only_node, 'node'))
    nopy = dict(placeholder, PATH=only_node)
    r = subprocess.run([shutil.which('node'), RUNJS, 'direct.py'], input='{}', env=nopy, capture_output=True, text=True, timeout=60)
    check('with no Python, a hook exits 0 and says why on stderr', r.returncode == 0 and 'Python' in r.stderr,
          f'rc={r.returncode} err={r.stderr[-300:]}')

    # the skill's own fallback, run from a shell with no node in between and no python3 anywhere on PATH
    r = subprocess.run(['bash', FRONT, 'help', 'context'], env=dict(placeholder, PATH=bare),
                       capture_output=True, text=True, timeout=60)
    check('scripts/axiomcode run directly finds `python` when there is no python3',
          r.returncode == 0 and 'context' in r.stdout and 'import sys' in calls(),
          f'rc={r.returncode} err={r.stderr[-300:]}')

print()
print(f"{len(checked) - len(fails)} of {len(checked)} check(s) held" if not fails else f"{len(fails)} FAILED: " + '; '.join(fails))
sys.exit(1 if fails else 0)
