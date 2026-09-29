#!/usr/bin/env python3
"""Keep the graph current between runs (#1305): after an edit, a shell command, a finished turn, at session start and
on a prompt, start the background refresher and return. Nothing is waited on, and nothing is printed except, once per
session, that a graph another axiomcode built is kept rather than rebuilt (ax_fresh.hook_kick).

The refresher (skills/axiomcode/scripts/ax_fresh.py) compares the files the parser reads against the table recorded
at the last build, and rebuilds only when one differs, one build at a time per repository, while every verb and hook
keeps reading the previous graph until the new one is indexed and swapped in. A hook that fires on every edit would be
the wrong place to BUILD (a warm rebuild is about a minute); it is the right place to say "something may have changed".
No graph yet: nothing happens here; the first build is `axiomcode index`, or the first query verb."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _host, _where

try:
    ev = _host.read()
except Exception:
    sys.exit(0)
cwd = ev.get('cwd') or os.getcwd()
# the repository whose graph this is: the one above the file or directory the tool touched (an edit by absolute path
# from a directory with no graph is still an edit to that repository), else the working directory or its nearest parent
# holding a graph. An event that names no path (a prompt, the end of a turn, a session start) also refreshes the
# repositories this session has worked in, the most recent two.
try:
    d = _where.locate(ev.get('tool_name') or '', ev.get('tool_input') or {}, cwd, ev.get('session_id'))
    repos = [d] if d else []
    if not ev.get('tool_name'):
        repos += [r for r in _where.recent() if r not in repos][:2]
except Exception:
    repos = []
repos = [r for r in repos if os.path.exists(os.path.join(r, '.axiomcode', 'out', 'graph.sqlite'))]
if not repos: sys.exit(0)
# A GRAPH ANOTHER AXIOMCODE BUILT IS NOT THE HOOKS' TO REBUILD. A hook fires on a shell command that only read, and a
# graph built with a checkout's own engine (and measured) was rebuilt with the installed one behind the agent's back. Such
# a graph is kept, and said so once per session (ax_fresh.hook_kick); an edit over a graph this axiomcode built still
# starts the refresher, as before.
said = []
try:
    import ax_fresh
    for d in repos:
        n = ax_fresh.hook_kick(d, f"the {ev.get('hook_event_name') or 'hook'} hook" + (f" after {ev['tool_name']}" if ev.get('tool_name') else ''),
                               session=str(ev.get('session_id') or ''))
        if n: said.append(n if len(repos) == 1 else f"{d}: {n}")
except Exception:
    pass                                                  # a hook never fails the tool call it rides on
if said and (ev.get('hook_event_name') or '') in ('PostToolUse', 'UserPromptSubmit', 'SessionStart'):
    try: _host.emit(ev['hook_event_name'], '\n'.join(said))
    except Exception: pass
