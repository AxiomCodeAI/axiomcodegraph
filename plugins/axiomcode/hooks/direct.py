#!/usr/bin/env python3
"""PreToolUse on Read|Grep|Glob|Bash (and the graph's own MCP tools, which silence it): say it at the moment the alternative is about to run.

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
  · ONCE PER SESSION. Said in full before the first search, then never again. It used to repeat as one line
    before every later Read, Grep and Bash, and in a measured run those lines were seven of the plugin's
    injections, re-read on every turn after, for an agent that had already called the graph twice. A
    reminder only has to be visible once; after that it is a context tax on every turn.
  · ONLY WHERE THE CHOICE IS. A Bash call that searches or reads source competes with the graph; `git`,
    `ls`, a build or a test run does not, and a directive in front of one is noise.
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _host

MARK = '.axiomcode/.directed-{}'               # once per session: keyed by session id, not once per repo forever
SRC = ('.java', '.ts', '.tsx', '.py', '.js', '.jsx', '.mjs', '.cjs', '.cs')
# the shell commands that are the search or read this directive competes with
SEARCH = re.compile(r'(^|[;&|(]\s*|\s)(grep|egrep|rg|ag|ack|git\s+grep|find|fd|cat|head|tail|sed|awk|less)\b')

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

def main():
    ev = _host.read()
    tool = ev.get('tool_name') or ''
    inp = ev.get('tool_input') or {}
    cwd = ev.get('cwd') or os.getcwd()

    if not os.path.exists(os.path.join(cwd, '.axiomcode', 'out', 'graph.sqlite')):
        sys.exit(0)

    stamp = os.path.join(cwd, MARK.format(ev.get('session_id') or 'x'))

    # the agent is already reaching for the graph -- saying it again is the nag this is trying not to be,
    # and once it has, the directive has nothing left to say this session
    if 'axiomcode' in tool or (tool == 'Bash' and 'axiomcode' in (inp.get('command') or '')):
        try:
            os.makedirs(os.path.dirname(stamp), exist_ok=True)
            open(stamp, 'w').close()
        except Exception:
            pass
        sys.exit(0)

    # a Read of something that is not source is not the decision this is about (a log, a lockfile, a README)
    if tool == 'Read':
        fp = inp.get('file_path') or ''
        if not fp.endswith(SRC):
            sys.exit(0)

    if tool == 'Bash' and not SEARCH.search(inp.get('command') or ''):
        sys.exit(0)

    if os.path.exists(stamp):
        sys.exit(0)
    try:
        os.makedirs(os.path.dirname(stamp), exist_ok=True)
        open(stamp, 'w').close()
    except Exception:
        pass

    text = FULL
    # stream-json does not carry additionalContext, so a run cannot show from its transcript that this
    # fired or what it said -- and #1100 is a question about exactly that. enrich.py already logs itself
    # next to the graph for the same reason; this writes the same file, so one reader sees both halves.
    try:
        with open(os.path.join(cwd, '.axiomcode', 'hooks.jsonl'), 'a') as f:
            f.write(json.dumps({'hook': 'direct', 'tool': tool, 'chars': len(text),
                                'input': {k: v for k, v in inp.items()
                                          if k in ('file_path', 'pattern', 'command')}}) + '\n')
    except OSError:
        pass
    _host.emit('PreToolUse', text)


# THIS HOOK RUNS BEFORE EVERY Read, Grep, Glob AND Bash THE AGENT MAKES. A hook that raises on one of them
# costs that agent the turn, in a repository whose only fault is having a graph. Nothing it does is worth a
# failed tool call, so every path out of it is exit 0: a directive is an optional courtesy, not a dependency.
if __name__ == '__main__':
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
