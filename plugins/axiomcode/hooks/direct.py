#!/usr/bin/env python3
"""PreToolUse on Read|Grep|Glob|Bash: say it at the moment the alternative is about to run.

#1100 measured three changes to what this skill SAYS and none of them moved the number: the body cut by
72%, the description rewritten into the words a task is phrased in, and orient.py's first turn turned from
bare directory names into ranked entry points. `graph_calls` stayed 0 in 17 of 18 runs. What those three
have in common is WHERE they speak: a surface the agent reads once, before it has a question.

This is the other axis. Not better wording — the same claim, placed at the only moment it competes with
anything: immediately before a raw search or read, which is the action it is asking to come second.

Rules it holds itself to, in the spirit of orient.py:
  · SILENT WITHOUT A GRAPH. No graph.sqlite means the verbs cannot answer, and a directive toward a tool
    that has nothing to say is pure noise. This is the difference between a directive and a nag.
  · SILENT WHEN THE AGENT IS ALREADY DOING IT. A Bash call that IS an axiomcode verb gets nothing.
  · NEVER BLOCKS. additionalContext, exit 0. The agent keeps its own judgement; the point is that the
    judgement is made with the option in view, not that the option wins.
  · BOUNDED AND DECAYING. Said in full once per session, then one line. Repetition is the mechanism under
    test, so it does repeat — but orient.py is right that a paragraph on every turn is a context tax, and
    the reminder only has to be visible, not re-argued.
"""
import json, os, sys

MARK = '.axiomcode/.directed'                  # full text once per session, per repo
SRC = ('.java', '.ts', '.tsx', '.py', '.js', '.jsx', '.mjs', '.cjs', '.cs')

FULL = (
    "graph: this repository has a resolved call graph, and it answers the question this search is asking.\n"
    "  `axiomcode impact <name>` — everything a change to that declaration reaches, each entry labelled\n"
    "     with how certain it is; finds callers that never spell the name (an interface, an override, a\n"
    "     callback, DI, a config key), which is what a grep for the name cannot do.\n"
    "  `axiomcode path <A> <B>` — how one thing reaches another.  `axiomcode context \"<task>\"` — where a\n"
    "     task's words land.  `axiomcode changed` / `test-impact` — what an edit moved and which tests reach it.\n"
    "  Search raw files after that, to read or to change specific lines. If you hand this to a subagent,\n"
    "  carry this line into its prompt — exploration done in a child is exploration done without the graph."
)
ONE = ("graph: `axiomcode impact <name>` resolves callers this search will miss "
       "(interface, override, callback, DI, config key).")

try:
    ev = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool = ev.get('tool_name') or ''
inp = ev.get('tool_input') or {}
cwd = ev.get('cwd') or os.getcwd()

if not os.path.exists(os.path.join(cwd, '.axiomcode', 'out', 'graph.sqlite')):
    sys.exit(0)

# the agent is already reaching for the graph -- saying it again is the nag this is trying not to be
if tool == 'Bash' and 'axiomcode' in (inp.get('command') or ''):
    sys.exit(0)

# a Read of something that is not source is not the decision this is about (a log, a lockfile, a README)
if tool == 'Read':
    fp = inp.get('file_path') or ''
    if not fp.endswith(SRC):
        sys.exit(0)

stamp = os.path.join(cwd, MARK)
first = not os.path.exists(stamp)
if first:
    try:
        os.makedirs(os.path.dirname(stamp), exist_ok=True)
        open(stamp, 'w').close()
    except Exception:
        pass

print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse',
                                         'additionalContext': FULL if first else ONE}}))
