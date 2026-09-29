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
  · ONCE PER SESSION, WHEREVER THE SESSION GOES. Said once, then never again. It used to repeat as one line before
    every later Read, Grep and Bash; then it was stamped once per session PER REPOSITORY, inside that repository's
    .axiomcode/, so an agent moving between a worktree, its fixtures and a corpus app heard the full text in each,
    and one whose .axiomcode/ it could not write heard it before every search. The stamp now lives in the temp
    directory, keyed by the session alone.
  · ONLY WHEN IT CAN NAME WHAT THIS SEARCH IS ABOUT. The generic text was spoken before the first search whatever
    it searched for, and a feed audit found it acted on 0% of the time: advice about "a name" in front of a search
    for `TODO` or `'use strict'` is not advice about this search. It now speaks only before a search whose pattern
    names a class, function or method the graph declares, names it with where it is, and gives the one call that
    answers what the grep is asking. A Read of a file already chosen and a Glob for files are not that question.
  · ONLY WHERE THE CHOICE IS. A Bash call that searches source competes with the graph; `git`, `ls`, a build, a
    test run, or a grep filtering another command's output does not, and a directive in front of one is noise.
"""
import hashlib, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _host, _where

# the shell commands that are the search this directive competes with, and the pattern each one searches for
SEARCH = re.compile(r'(^|[;&|(]\s*|\s)(grep|egrep|rg|ag|ack|git\s+grep)\b')
PATTERN = re.compile(r'\b(?:grep|egrep|rg|ag|ack|git\s+grep)\b((?:\s+-[-\w=]+)*)\s+(?:-e\s+)?([\'"]?)(.+?)\2(?:\s|$)')
# the declarations a search can be asking about: a callable or a type. A field, a constant or a local shares its name
# with too much prose and config to be the thing a grep for that word is after.
KINDS = ('class', 'interface', 'enum', 'record', 'struct', 'trait', 'function', 'method', 'constructor')
SPREAD = 5
COMMON = re.compile(r'(the|and|for|new|return|null|true|false|this|self|void|int|String|public|private|static|import|export|const|function|class|def)')


def stamp_path(sid, cwd=''):
    """one file per session, outside every repository: a repository's .axiomcode/ is per tree, gets rebuilt, and is not
    always writable, and each of those made the directive say itself again. A host that sends no session id is keyed
    on the directory it runs in instead, so every such session does not share one stamp and hear it once, ever."""
    tmp = os.environ.get('TMPDIR') or os.environ.get('TEMP') or os.environ.get('TMP') or ('/tmp' if os.name != 'nt' else os.path.expanduser('~'))
    key = str(sid) if sid else 'cwd-' + hashlib.sha1(os.path.realpath(cwd or '.').encode()).hexdigest()[:16]
    return os.path.join(tmp, 'axiomcode-hooks', 'directed-' + (re.sub(r'[^\w.-]', '_', key)[:80] or 'x'))


def mark(stamp):
    try:
        os.makedirs(os.path.dirname(stamp), exist_ok=True)
        open(stamp, 'w').close()
    except Exception:
        pass


def identifiers(pat):
    """the names a search pattern spells: every branch of an alternation, regex syntax stripped, at most 6"""
    out = []
    for br in re.split(r'\\\||(?<!\\)\|', str(pat or '')):
        for m in re.finditer(r'(?<![\w\\])[A-Za-z_]\w{2,}', br):
            n = m.group(0)
            if COMMON.fullmatch(n) or re.fullmatch(r'[A-Z0-9_]+', n) or n in out:
                continue          # a keyword or a CONSTANT_SHAPED word is not a callable's name
            # a plain lowercase word (`once`, `path`, `session`) is as likely prose or a flag as a name, unless THAT
            # word is written as code: `locate\(`, `def locate`, `.locate`, `function render`. Code elsewhere in the
            # pattern does not count: in `expr_child("client"` the name is expr_child, and client is a string.
            if n.islower() and '_' not in n and not (
                    re.match(r'\\?\(', br[m.end():])
                    or re.search(r'(\b(def|function|fn|func|void|class)\s+|\\?\.|::|->)$', br[:m.start()])):
                continue
            out.append(n)
    return out[:6]


def declared(root, names, scope=()):
    """[(name, display, file, line)] for the names a graph in `root` declares as a callable or a type: the declaration
    inside the searched files or directories (`scope`, relative to root) first, then the first in the repository. A
    name declared in more than SPREAD places (`get`, `run`, `handle`) says nothing about which one this search is for,
    and naming one of them is a guess, so it is left out."""
    import sqlite3
    ax = os.path.join(root, '.axiomcode')
    dbs = [os.path.join(ax, 'out', 'graph.sqlite')]
    try:
        dbs += [os.path.join(ax, 'lang', l, 'out', 'graph.sqlite') for l in sorted(os.listdir(os.path.join(ax, 'lang')))]
    except OSError:
        pass
    found = {}
    ph = ','.join('?' * len(KINDS))
    for db in dbs:
        if len(found) == len(names) or not os.path.isfile(db):
            continue
        try:
            con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
            for n in names:
                if n in found:
                    continue
                rows = con.execute(f"SELECT display, file, line FROM symbols WHERE name = ? AND kind IN ({ph}) "
                                   f"ORDER BY is_test, file, line LIMIT {SPREAD + 1}", (n, *KINDS)).fetchall()
                if not rows or len(rows) > SPREAD:
                    continue
                inside = [r for r in rows if any(r[1] == s or r[1].startswith(s.rstrip('/') + '/') for s in scope)]
                r = (inside or rows)[0]
                found[n] = (n, r[0], r[1], r[2])
            con.close()
        except Exception:
            continue
    return [found[n] for n in names if n in found]


def directive(hits):
    """what to say before a search for these declarations: each named, with the call that answers what the grep asks"""
    first = hits[0]
    at = f"{first[2]}:{first[3]}"
    named = ', '.join(f"`{h[1]}` ({h[2]}:{h[3]})" for h in hits[:3])
    # short on purpose: it is read once and then re-read on every later turn
    return (
        f"graph: this search is for {named}. Who calls it and what a change breaks,\n"
        f"  with the callers that never spell the name (an interface, an override, a callback, DI):\n"
        f"  axiomcode_impact targets=[\"{at}\"] (`axiomcode impact {at}`). Also axiomcode_path (how A reaches B,\n"
        f"  `axiomcode path A B`), axiomcode_context (a task in words, `axiomcode context \"<task>\"`). Said once this session."
    )


def main():
    ev = _host.read()
    tool = ev.get('tool_name') or ''
    inp = ev.get('tool_input') or {}
    stamp = stamp_path(ev.get('session_id'), ev.get('cwd') or os.getcwd())

    # the agent is already reaching for the graph -- saying it again is the nag this is trying not to be,
    # and once it has, the directive has nothing left to say this session, in any repository
    if 'axiomcode' in tool or (tool == 'Bash' and 'axiomcode' in (inp.get('command') or '')):
        mark(stamp)
        sys.exit(0)
    if os.path.exists(stamp):
        sys.exit(0)

    # only a search has a pattern that can name what it is looking for; a Read of a chosen file or a Glob does not
    here = ev.get('cwd') or os.getcwd()
    if tool == 'Grep':
        pat = inp.get('pattern') or ''
        paths = [inp['path']] if inp.get('path') else []
    elif tool == 'Bash':
        cmd = inp.get('command') or ''
        m = SEARCH.search(cmd) and PATTERN.search(cmd)
        if not m:
            sys.exit(0)
        # after a `|` a grep filters another command's output (`npm test | grep FAIL`), which is not a code search
        seps = re.findall(r'\|\||&&|;|\n|\|', cmd[:m.start()])
        if seps and seps[-1] == '|':
            sys.exit(0)
        # a search whose every file is not source (`grep x NOTES.md`, `rg y run.log`) is not the decision this is about
        _, paths = _where.bash_where(cmd, here)
        files = [p for p in paths if os.path.isfile(p)]
        if files and not any(_where.is_source(p) for p in files):
            sys.exit(0)
        pat = m.group(3)
    else:
        sys.exit(0)

    names = identifiers(pat)
    if not names:
        sys.exit(0)
    # the repository whose graph would answer: the one above the file or directory this tool is about to touch, not
    # the session's working directory, which in 308 of 309 measured sessions held no graph (_where.py)
    cwd = _where.locate(tool, inp, here, ev.get('session_id'))
    if not cwd:
        sys.exit(0)
    real = os.path.realpath(cwd)
    scope = [os.path.relpath(os.path.realpath(os.path.join(here, p)), real) for p in paths]
    hits = declared(cwd, names, [s for s in scope if s != '.' and not s.startswith('..')])
    if not hits:
        sys.exit(0)

    mark(stamp)
    text = directive(hits)
    # stream-json does not carry additionalContext, so a run cannot show from its transcript that this
    # fired or what it said -- and #1100 is a question about exactly that. enrich.py already logs itself
    # next to the graph for the same reason; this writes the same file, so one reader sees both halves.
    try:
        with open(os.path.join(cwd, '.axiomcode', 'hooks.jsonl'), 'a') as f:
            f.write(json.dumps({'hook': 'direct', 'tool': tool, 'chars': len(text), 'named': [h[1] for h in hits],
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
