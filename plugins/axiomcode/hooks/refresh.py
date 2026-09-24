#!/usr/bin/env python3
"""Keep the graph current between runs (#1305): after an edit, a shell command, a finished turn, at session start and
on a prompt, start the background refresher and return. Nothing is waited on and nothing is printed.

The refresher (skills/axiomcode/scripts/ax_fresh.py) compares the files the parser reads against the table recorded
at the last build, and rebuilds only when one differs, one build at a time per repository, while every verb and hook
keeps reading the previous graph until the new one is indexed and swapped in. A hook that fires on every edit would be
the wrong place to BUILD (a warm rebuild is about a minute); it is the right place to say "something may have changed".
No graph yet: nothing happens here; the first build is `axiomcode index`, or the first query verb."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _host

try:
    ev = _host.read()
except Exception:
    sys.exit(0)
cwd = ev.get('cwd') or os.getcwd()
# the repository whose graph this is: the working directory or the nearest parent holding a graph
d = os.path.realpath(cwd)
while not os.path.exists(os.path.join(d, '.axiomcode', 'out', 'graph.sqlite')):
    up = os.path.dirname(d)
    if up == d: sys.exit(0)
    d = up
try:
    import ax_fresh
    ax_fresh.kick(d, trigger=f"the {ev.get('hook_event_name') or 'hook'} hook" + (f" after {ev['tool_name']}" if ev.get('tool_name') else ''))
except Exception:
    pass                                                  # a hook never fails the tool call it rides on
