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
import json, os, re, shlex, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _host, _where

SRC = _where.SOURCE_EXT                        # one table for every hook (_where.py)
# the shell commands that are the search or read this directive competes with
SEARCH = re.compile(r'(^|[;&|(]\s*|\s)(grep|egrep|rg|ag|ack|git\s+grep|find|fd|cat|head|tail|sed|awk|less)\b')
# words a search pattern is made of that name no declaration (a keyword written into the pattern to anchor it)
KEYWORDS = {'def', 'class', 'public', 'private', 'protected', 'static', 'final', 'void', 'function', 'import', 'from',
            'return', 'new', 'async', 'await', 'self', 'this', 'interface', 'struct', 'record', 'override', 'virtual',
            'const', 'let', 'var', 'string', 'int', 'bool', 'true', 'false', 'null', 'None', 'True', 'False', 'package',
            'namespace', 'using', 'extends', 'implements'}
CALLABLE = ('method', 'function', 'constructor')

# The MCP tools are named first and the shell verbs second (#1425): `axiomcode install` pre-approves only the tools,
# so an agent that takes the first spelling it reads should be taking the one it is already allowed to call.
# Short on purpose: it is read once, and 13 generic lines were re-read on every later turn.
FULL = (
    "graph: this repository has a resolved call graph; ask it before a raw search. axiomcode_impact targets=[<name>]:\n"
    "  who uses a declaration and what a change breaks, with callers that never spell the name (an interface, an override,\n"
    "  a callback, DI). axiomcode_path: how A reaches B. axiomcode_context: where a task lands. axiomcode_changed /\n"
    "  axiomcode_test_impact: what an edit moved, which tests reach it. Shell: `axiomcode impact <name>`, `axiomcode path\n"
    "  <A> <B>`, `axiomcode context \"<task>\"`, `axiomcode changed`, `axiomcode test-impact`. Pass this to a subagent."
)

# after a line that already names the verb for THIS search, the rest of the menu in one line
REST = ("  Also: axiomcode_path (how A reaches B), axiomcode_context (a task in words), axiomcode_test_impact (the tests an"
        " edit reaches); in a shell `axiomcode <verb>`. Pass this to a subagent.")


def _stamp(cwd, sid):
    """ONCE PER SESSION, not once per (session, repository): keyed on the session in the temp directory, so an agent
    that moves between repositories (a dev copy, a second service) hears it the first time only. A session with no id
    keeps the old per-repository stamp, since every such session would otherwise share one."""
    if not sid:
        return os.path.join(cwd, '.axiomcode', '.directed-x')
    tmp = os.environ.get('TMPDIR') or os.environ.get('TEMP') or os.environ.get('TMP') or ('/tmp' if os.name != 'nt' else os.path.expanduser('~'))
    return os.path.join(tmp, 'axiomcode-hooks', 'directed-' + (re.sub(r'[^\w.-]', '_', str(sid))[:80] or 'x'))


def _pattern(tool, inp):
    """the text a search looks for: Grep's pattern, or the first argument after grep / rg / ag / ack in a shell command"""
    if tool == 'Grep':
        return str(inp.get('pattern') or '')
    if tool == 'Bash':
        try: toks = shlex.split(str(inp.get('command') or ''))
        except ValueError: toks = str(inp.get('command') or '').split()
        for i, t in enumerate(toks):
            if t in ('grep', 'egrep', 'rg', 'ag', 'ack'):
                j = i + 1
                while j < len(toks) and toks[j].startswith('-'):
                    if toks[j] in ('-e', '--regexp'): j += 1; break
                    j += 2 if toks[j] in ('-f', '-A', '-B', '-C', '-m', '--include', '--exclude', '-g', '-t', '--type') else 1
                if j < len(toks): return toks[j]
    return ''


def specific(cwd, tool, inp, fp):
    """ONE line naming the verb that answers THIS search, when the graph has what it names: a Grep for a declared name
    gets `impact` on that declaration, a Read of an indexed file gets `context` scoped to it. '' when the graph has
    nothing to say about it (the generic block then stands alone)."""
    import sqlite3
    db = _where.graph_db(cwd, fp or None)
    if not os.path.isfile(db):
        return ''
    try:
        con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    except sqlite3.Error:
        return ''
    try:
        pat = _pattern(tool, inp)
        if pat:
            for w in re.findall(r'[A-Za-z_]\w{2,}', pat):
                if w in KEYWORDS:
                    continue
                rows = con.execute("SELECT display, kind, file, line FROM symbols WHERE name = ? AND kind != 'module' "
                                   "ORDER BY is_test, (kind IN ('method','function','constructor')) DESC, file, line LIMIT 4", (w,)).fetchall()
                if not rows:
                    continue
                disp, kind, f, l = rows[0]
                target = disp if len(rows) == 1 else w
                what = 'Who calls it and what a change breaks' if kind in CALLABLE else \
                       ('Who reads and writes it' if kind in ('field', 'const', 'variable', 'property') else 'Who uses it, its subtypes, what a change breaks')
                where = f"{disp}, {f}:{l}" if len(rows) == 1 else f"{len(rows) if len(rows) < 4 else '4+'} declarations, first {disp} {f}:{l}"
                return (f"graph: `{w}` is declared here ({where}). {what}: axiomcode_impact targets=[\"{target}\"]"
                        f" (`axiomcode impact {target}`); a grep misses the callers that never spell it.")
        if tool in ('Read', 'Bash') and fp:
            rel = os.path.relpath(os.path.realpath(fp), os.path.realpath(cwd)).replace(os.sep, '/')
            n = con.execute("SELECT count(*) FROM symbols WHERE file = ? AND kind IN ('method','function','constructor')", (rel,)).fetchone()[0]
            if n:
                return (f"graph: {rel} has {n} callable(s) in the graph. How it works: axiomcode_context task=\"<question>\""
                        f" in_path=\"{rel}\" source=True; one of them: axiomcode_impact targets=[\"{rel}:<line>\"].")
    except sqlite3.Error:
        pass
    finally:
        con.close()
    return ''


def main():
    ev = _host.read()
    tool = ev.get('tool_name') or ''
    inp = ev.get('tool_input') or {}
    # the repository whose graph would answer: the one above the file or directory this tool is about to touch, not
    # the session's working directory, which in 308 of 309 measured sessions held no graph (_where.py)
    cwd = _where.locate(tool, inp, ev.get('cwd') or os.getcwd(), ev.get('session_id'))
    if not cwd:
        sys.exit(0)

    stamp = _stamp(cwd, ev.get('session_id'))

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
        if not _where.is_source(_where._abs(fp, ev.get('cwd') or os.getcwd())):
            sys.exit(0)

    if tool == 'Bash' and not SEARCH.search(inp.get('command') or ''):
        sys.exit(0)
    # the same rule as a Read: a shell read or search whose every file is not source (`cat NOTES.md`, `tail run.log`)
    # is not the decision this is about. Of the 3 times this hook spoke in 190 measured agents, one was a `cat` of a
    # Markdown file. A search with no file argument (a directory, or none) still searches source.
    if tool == 'Bash':
        _, paths = _where.bash_where(inp.get('command'), ev.get('cwd') or os.getcwd())
        files = [p for p in paths if os.path.isfile(p)]
        if files and not any(_where.is_source(p) for p in files):
            sys.exit(0)

    if os.path.exists(stamp):
        sys.exit(0)
    try:
        os.makedirs(os.path.dirname(stamp), exist_ok=True)
        open(stamp, 'w').close()
    except Exception:
        pass

    fp = _where._abs(inp['file_path'], ev.get('cwd') or os.getcwd()) if tool == 'Read' and inp.get('file_path') else \
         (next((p for p in files if _where.is_source(p)), '') if tool == 'Bash' else '')
    try:
        one = specific(cwd, tool, inp, fp)
    except Exception:
        one = ''
    text = (one + '\n' + REST) if one else FULL
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
