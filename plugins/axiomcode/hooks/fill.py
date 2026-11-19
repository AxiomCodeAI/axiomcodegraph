#!/usr/bin/env python3
"""UserPromptSubmit: after a build, tell the agent once that the engine left call sites it could not resolve.

The engine has done what it can by the end of a build; what is left is for someone who reads the code. This says so
ONCE per build (ax_fill.notice keeps the stamp in .axiomcode/.fill-noted-hook) and only when sites that may land in the
project are open, naming the one command that starts the pass: /axiomcode:fill. Silent with no graph, with nothing open,
and on every prompt after the first that heard about this build.
"""
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _host

try:
    ev = _host.read()
except Exception:
    sys.exit(0)

def repo_root(start):
    cur = os.path.realpath(start)
    while True:
        if os.path.exists(os.path.join(cur, '.axiomcode', 'out', 'graph.sqlite')): return cur
        parent = os.path.dirname(cur)
        if parent == cur: return None
        cur = parent

root = repo_root(ev.get('cwd') or os.getcwd())
if not root: sys.exit(0)
script = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts', 'ax_fill.py')
try:
    r = subprocess.run([sys.executable, script, root, '--notice', 'hook'], capture_output=True, text=True, timeout=8)
    line = r.stdout.strip()
except Exception:
    sys.exit(0)
if line: _host.emit('UserPromptSubmit', line)
