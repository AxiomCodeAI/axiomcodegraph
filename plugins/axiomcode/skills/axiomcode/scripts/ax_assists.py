#!/usr/bin/env python3
"""Where an AxiomCode answer verifiably helped the agent, read from the session record (#1935).

Agents finish a task with and without AxiomCode, and they rarely say which answer changed what they did, so the user
never sees it. This reads the host's transcript (the agent's tool calls and their results, in order) and finds chains
an answer started:

    cause   an AxiomCode answer (context / impact / path / tests) names a file
    action  the file was FIRST SEEN in that answer (no earlier prompt, tool call, tool result or reply named it), and
            the agent then read it, edited it, or ran the tests the answer picked
    effect  the edit is still in the working tree, and the picked tests that ran passed

Each chain gets the strongest label it qualifies for:

    Redirected  Helped, and before the answer the agent was reading or editing other files in that turn, which it never
                touched again and which are not in the final diff: the answer moved the work
    Helped      a file first seen in the answer was edited and the edit is kept, or the answer's picked tests ran and passed
    Useful      a file first seen in the answer was read (or its picked tests ran), and nothing was edited from it

Nothing here comes from what the agent SAYS: its reply has already been shown when a Stop hook runs, so a claim in it
could not be checked before the user read it. Only links that were checked are printed; a chain is cut back to the
last link that holds, and an answer that led to nothing prints nothing. No counterfactual is stated ("grep would have
missed it"): only what happened in the session.

Chains are appended to <repo>/.axiomcode/assists.jsonl, which only this module writes. A chain is printed once, and
again only when it grows a stronger label or a new edited file, so each turn shows what is new in that turn.

    ax_assists.py report [repo]                 every recorded chain as HTML (<repo>/.axiomcode/assists.html)
    ax_assists.py replay <transcript> [root]    what each turn of a past session would have printed
"""
import html, json, os, re, subprocess, sys, time

LEDGER = os.path.join('.axiomcode', 'assists.jsonl')
RANK = {'Useful': 1, 'Helped': 2, 'Redirected': 3}

# an answer: the MCP tools (current and older names), or the CLI verbs run through a shell
MCP = re.compile(r'^mcp__.*axiomcode.*__(?:axiomcode_)?(context|impact|path|tests|test_impact|changed)$')
CLI = re.compile(r'(?:^|[\s;&|(/])axiomcode(?:-(context|impact|path|test-impact|changed)|\s+(context|impact|path|tests|test-impact|changed))\b([^;&|\n]*)')

EXT = (r'py|pyi|ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte|astro|java|kt|kts|scala|groovy|cs|cshtml|razor|fs|go|rs|rb|'
       r'php|swift|m|mm|c|cc|cpp|cxx|h|hpp|sql|proto|graphql|gql')
PATH = re.compile(r'(?<![\w@.+-])((?:/|\.{1,2}/)?(?:[\w@.+-]+/)*[\w@+-][\w@.+-]*\.(?:' + EXT + r'))(?=$|[^\w/-])')
GENERIC = re.compile(r'^(?:index|main|__init__|__main__|mod|lib|app|setup|conftest|init|util|utils|types|constants)\.\w+$')
CONFIG = re.compile(r'\.config\.[cm]?[jt]s$|(?:^|/)(?:jest|vitest|karma|babel|tsconfig)[\w.-]*\.(?:[cm]?[jt]s|json)$')
TEST_FILE_ = re.compile(r'(?:^|/)(?:tests?|__tests__|spec|specs)/|(?:^|/)test_[^/]+$|_test\.\w+$|\.(?:test|spec)\.\w+$|'
                       r'Tests?\.(?:java|kt|cs|scala)$|IT\.java$')


class _TestFile:
    """a test file by its path; a runner's config next to the tests (test/jest.config.js) is not one"""
    @staticmethod
    def search(f):
        return None if CONFIG.search(f) else TEST_FILE_.search(f)


TEST_FILE = _TestFile
TEST_RUN = re.compile(r'(?:^|[\s;&|(])(?:pytest|py\.test|tox|nox|jest|vitest|mocha|ava|tap|go\s+test|cargo\s+test|'
                      r'dotnet\s+test|mvn\b[^;&|]*\b(?:test|verify)\b|mvnw\b[^;&|]*\b(?:test|verify)\b|gradlew?\b[^;&|]*\btest\b|'
                      r'(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|python3?\s+-m\s+(?:pytest|unittest))')
FAILED = re.compile(r'\b[1-9]\d* (?:failed|failing)\b|Tests:\s+[1-9]\d* failed|\bFAIL\s')
# a pass is the runner saying so (pytest, jest, vitest, mocha, unittest, go, dotnet, maven); an exit 0 alone is not one,
# since a test line often ends in `| tail` or `; ruff check`, and a run that never started exits 0 there too
PASSED = re.compile(r'\b[1-9]\d* (?:passed|passing)\b|^\s*PASS\s|^OK\b|^ok\s|\bPassed!|Tests run: [1-9]\d*, Failures: 0, Errors: 0', re.M)
BROKE = re.compile(r'\b[1-9]\d* errors?\b|\bno tests ran\b|ERROR collecting|ModuleNotFoundError|ImportError while')
SHELL_READ = re.compile(r'(?:^|[;&|(]|\n|&&)\s*(?:cat|sed\s+-n\s+\S+|head(?:\s+-n?\s*\d+)?|tail(?:\s+-n?\s*\d+)?|less|bat|nl|'
                        r'grep\s+-n\S*\s+\S+|rg\s+-n\S*\s+\S+)\s+([^;&|<>\n]+)')     # the command, then its file arguments
EDIT_TOOLS = {'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'replace', 'write_file'}
READ_TOOLS = {'Read', 'read_file', 'NotebookRead'}
HARNESS = ('<task-notification>', '<system-reminder>', '[SYSTEM NOTIFICATION', '<command-', '<local-command', 'Caveat:')


# ---- the transcript -------------------------------------------------------------------------------------------------

def _text(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return '\n'.join(_text(x) for x in c)
    if isinstance(c, dict):
        if c.get('type') == 'text' or 'text' in c:
            return str(c.get('text') or '')
        if 'content' in c:
            return _text(c['content'])
        return ''
    return ''


def _unwrap(t):
    """an MCP tool's answer arrives as {"result": "<text>"}: the text, with its line breaks"""
    if t.startswith('{"result"'):
        try:
            v = json.loads(t).get('result')
            if isinstance(v, str):
                return v
        except ValueError:
            pass
    return t


HOOK = 'axiomcode-hook'


def _graph_note(a):
    """the hook event when this attachment is a graph answer the plugin's hooks gave the agent, else ''"""
    if a.get('type') == 'hook_additional_context' or (a.get('type') == 'hook_success'
                                                       and a.get('hookEvent') == 'UserPromptSubmit'):
        if _text(a.get('content')).lstrip().startswith('graph:'):
            return str(a.get('hookEvent') or a.get('hookName') or '').split(':')[0]
    return ''


def steps(transcript):
    """the session in order: prompts, replies and tool calls with their results. Side chains (subagents) are left out:
    what a subagent saw, the agent saw only as the subagent's reply."""
    out, calls = [], {}
    try:
        f = open(transcript, encoding='utf-8', errors='replace')
    except OSError:
        return out
    with f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if not isinstance(e, dict) or e.get('isSidechain'):
                continue
            if e.get('type') in ('attachment', 'system'):
                a = e.get('attachment') if isinstance(e.get('attachment'), dict) else {}
                hook = _graph_note(a)
                if hook:
                    # the plugin's own hooks put a graph answer in front of the agent: after an edit, the callers it
                    # reaches; on a prompt, where the task lands. That is an answer like a tool call's.
                    out.append({'kind': 'call', 'id': 'hook:' + str(e.get('uuid') or len(out)), 'name': HOOK,
                                'input': {'event': hook}, 'result': _text(a.get('content')), 'error': False,
                                'ts': e.get('timestamp') or ''})
                    continue
                if a.get('type') == 'hook_success' and 'graph:' in str(a.get('stdout') or '') and \
                        str(a.get('hookEvent')) != 'UserPromptSubmit':
                    continue                  # the same text as the hook_additional_context that follows it
                # a hook's context, a mentioned file, a reminder: the agent saw it, so what it names is not first seen later
                t = json.dumps(e.get('attachment') or e.get('content') or '', ensure_ascii=False)
                if PATH.search(t):
                    out.append({'kind': 'note', 'text': t, 'ts': e.get('timestamp') or ''})
                continue
            if e.get('type') not in ('user', 'assistant'):
                continue
            msg = e.get('message') or {}
            content = msg.get('content')
            ts = e.get('timestamp') or ''
            if e['type'] == 'user':
                if isinstance(content, str) or (isinstance(content, list) and not any(
                        isinstance(x, dict) and x.get('type') == 'tool_result' for x in content)):
                    t = _text(content).strip()
                    if not t:
                        continue
                    real = not e.get('isMeta') and not t.startswith(HARNESS)
                    k = len(out)
                    while real and k and out[k - 1].get('name') == HOOK and out[k - 1]['input'].get('event') == 'UserPromptSubmit':
                        k -= 1                # the host records a prompt's own hook note before the prompt; it answers it
                    out.insert(k, {'kind': 'prompt' if real else 'note', 'text': t, 'ts': ts})
                    continue
                for x in content:
                    if isinstance(x, dict) and x.get('type') == 'tool_result':
                        s = calls.get(x.get('tool_use_id'))
                        if s is not None:
                            s['result'] = _unwrap(_text(x.get('content')))
                            s['error'] = bool(x.get('is_error'))
                            s['extra'] = json.dumps(e.get('toolUseResult') or '', ensure_ascii=False)
                continue
            for x in content if isinstance(content, list) else []:
                if not isinstance(x, dict):
                    continue
                if x.get('type') == 'text' and x.get('text'):
                    out.append({'kind': 'reply', 'text': x['text'], 'ts': ts})
                elif x.get('type') == 'tool_use':
                    # mid: the calls of one message go out together, before any of their answers is seen
                    s = {'kind': 'call', 'id': x.get('id'), 'name': x.get('name') or '', 'input': x.get('input') or {},
                         'result': '', 'error': False, 'ts': ts, 'mid': msg.get('id')}
                    calls[s['id']] = s
                    out.append(s)
    return out


# ---- paths ----------------------------------------------------------------------------------------------------------

def norm(p, root):
    p = p.strip().strip('\'"`')
    if not p:
        return ''
    if os.path.isabs(p):
        rp = os.path.realpath(p) if os.path.exists(p) else os.path.normpath(p)
        for r in {root, os.path.realpath(root)}:
            if rp == r or rp.startswith(r.rstrip(os.sep) + os.sep):
                return os.path.relpath(rp, r).replace(os.sep, '/')
        return rp.replace(os.sep, '/')
    return os.path.normpath(p).replace(os.sep, '/').lstrip('./') if not p.startswith('..') else os.path.normpath(p)


def paths_in(text, root):
    return {n for n in (norm(m.group(1), root) for m in PATH.finditer(text or '')) if n}


def _seen_text(s):
    if s['kind'] != 'call':
        return s['text']
    return json.dumps(s['input'], ensure_ascii=False) + '\n' + (s['result'] or '') + '\n' + s.get('extra', '')


# a code name as a task writes it: snake_case, CamelCase, camelCase or Owner.member — not a plain word (find, where, define)
IDENT = re.compile(r'(?<![\w/.])(?:_*[a-z0-9]+(?:_[a-z0-9]+)+_*|_+[A-Za-z]\w*|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+|'
                   r'[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+|'
                   r'[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)(?![\w/])')
PLACE = re.compile(r'/|:\d')           # an answer names a file as a place: a path, or file:line
SEGMENTS = re.compile(r'\s*(?:;|&&|\|\||\n)\s*')
QUIET = re.compile(r'^(?:cd|echo|printf|export|set|true|:)\b|^$')


# a row of an answer: `3. path/file.py:58  [resolved · Owner.name]`, or a further-away place `   path/file.py:56  name  [hop 2]`.
# grep -n prints `path:58:text` and cat prints code, so in a shell line that also ran those, only these rows are the answer's.
ROW = re.compile(r'^[ \t]*(?:\d+\.[ \t]+)?((?:/|\.{1,2}/)?(?:[\w@.+-]+/)*[\w@+-][\w@.+-]*\.(?:' + EXT + r')):\d+[ \t]{2,}(?:\S+[ \t]{2,})?\[', re.M)


def mixed(s):
    """a shell line that runs other commands beside the answer (cat, ls, grep …): their output shares the result, so
    nothing in it can be credited to the answer"""
    if s['name'] not in ('Bash', 'run_shell_command', 'Shell'):
        return False
    segs = [g for g in SEGMENTS.split(str(s['input'].get('command') or '')) if g.strip()]
    return sum(1 for g in segs if not QUIET.match(g.strip()) and not CLI.search(g)) > 0


def answer_of(s):
    """(verb, argument) when this step is an AxiomCode answer, else None"""
    if s['kind'] != 'call' or s['error']:
        return None
    if s['name'] == HOOK:
        return 'note', s['input'].get('event') or ''
    m = MCP.match(s['name'])
    if m:
        args = ' '.join(str(v) for v in s['input'].values() if isinstance(v, str) and v.strip())
        return m.group(1).replace('_', '-'), args
    if s['name'] in ('Bash', 'run_shell_command', 'Shell'):
        m = CLI.search(str(s['input'].get('command') or ''))
        if m:
            verb = m.group(1) or m.group(2)
            arg = re.sub(r'\s+(?:/|~)\S*$', '', (m.group(3) or '').strip())     # the trailing repository path
            arg = re.sub(r'\s*\d?>&?\S*', '', arg).strip()
            while arg.count(')') > arg.count('('):              # `(time axiomcode impact X) 2>&1`
                arg = arg[:arg.rindex(')')] + arg[arg.rindex(')') + 1:]
            arg = arg.strip()
            return verb, arg
    return None


def _source(p, root):
    """a source file of the repository, relative to it; '' for anything else (a tool's output file, a file elsewhere)"""
    n = norm(p, root)
    return n if n and not n.startswith(('/', '..')) and PATH.fullmatch(n) else ''


_Q = r'[\'"]([^\'"\n]+)[\'"]'
WRITES = [re.compile(r'open\(\s*' + _Q + r'\s*,\s*[\'"][wa]'),                         # open('f.py', 'w')
          re.compile(r'Path\(\s*' + _Q + r'\s*\)\.write_(?:text|bytes)\('),           # Path('f.py').write_text(
          re.compile(r'(?:^|[^<>&\d])>>?\s*[\'"]?([^\s\'";&|)]+)'),                      # > f.py
          re.compile(r'\btee\s+(?:-a\s+)?[\'"]?([^\s\'";&|]+)')]                          # tee f.py
VAR = re.compile(r'\b(\w+)\s*=\s*(?:Path\()?' + _Q)
SED_I = re.compile(r'\b(?:sed\s+(?:-[a-zE]*i\S*|--in-place)|perl\s+-[a-z]*i\w*)\s+([^;&|\n]+)')


def written(cmd, root):
    """the source files a shell line writes: the target of open(…, 'w'), a redirection, tee or sed -i, by literal path or
    through a variable the script assigned (p = 'f.py' … open(p, 'w')); a file the script only mentions is not written"""
    out = set()
    for r in WRITES:
        out |= {m.group(1) for m in r.finditer(cmd)}
    vars_ = {m.group(1): m.group(2) for m in VAR.finditer(cmd)}
    for m in re.finditer(r'open\(\s*(\w+)\s*,\s*[\'"][wa]|\b(\w+)\.write_(?:text|bytes)\(', cmd):
        v = m.group(1) or m.group(2)
        if v in vars_:
            out.add(vars_[v])
    for m in re.finditer(r'^([ \t]*)def\s+(\w+)\s*\(\s*(\w+)[^)]*\)\s*:(.*(?:\n\1[ \t]+.*)*)', cmd, re.M):
        name, param, body = m.group(2), m.group(3), m.group(4)
        if re.search(r'open\(\s*' + param + r'\s*,\s*[\'"][wa]|Path\(\s*' + param + r'\s*\)|\.write_(?:text|bytes)\(', body) and \
                re.search(r'\.write_(?:text|bytes)\(|open\([^)]*[\'"][wa]', body):
            out |= {g.group(1) for g in re.finditer(r'(?<![\w.])' + name + r'\(\s*' + _Q, cmd)}
    for m in SED_I.finditer(cmd):
        out |= {g.group(1) for g in PATH.finditer(m.group(1))}
    return {f for f in (_source(x, root) for x in out) if f}


def touched(s, root):
    """[(kind, files)] for one tool call, kind 'read' | 'edit' | 'test'. One shell line can be several (write a test, then
    run it); a write counts even when the line exits non-zero, since the working tree decides whether it was kept."""
    if s['kind'] != 'call':
        return []
    name, inp = s['name'], s['input']
    if name in EDIT_TOOLS:
        p = _source(inp.get('file_path') or inp.get('notebook_path') or inp.get('path') or '', root)
        return [('edit', {p})] if p and not s['error'] else []
    if name in READ_TOOLS:
        p = _source(inp.get('file_path') or inp.get('path') or '', root)
        return [('read', {p})] if p else []
    out = []
    if name in ('Bash', 'run_shell_command', 'Shell'):
        cmd = str(inp.get('command') or '')
        w = written(cmd, root)
        if w:
            out.append(('edit', w))
        if answer_of(s):
            return out                        # the rest of its output is the answer's, not a read or a test run
        if TEST_RUN.search(cmd):
            out.append(('test', {f for f in paths_in(cmd, root) if not f.startswith(('/', '..'))}))
        r = {f for m in SHELL_READ.finditer(cmd) for f in (_source(g.group(1), root) for g in PATH.finditer(m.group(1))) if f}
        if r:
            out.append(('read', r))
    return out


def _same(a, b):
    return a == b or a.endswith('/' + b) or b.endswith('/' + a)


def _hit(f, files):
    return any(_same(f, g) for g in files)


# ---- the chains -----------------------------------------------------------------------------------------------------

def _batch(ss, i):
    """the call at i and the calls sent in the same message"""
    m = ss[i].get('mid')
    return [x for x in ss if x['kind'] == 'call' and x.get('mid') == m] if m else [ss[i]]


def chains(ss, root, diff=None):
    """every chain the session holds. `diff`: the files changed in the working tree now (None: not known, an edit
    counts as kept)."""
    seen_full, seen_base = set(), set()
    asked_for = set()                         # identifiers the prompts so far name: a row about one was the task's lead
    first = {}                                # file -> index of the answer that first showed it
    answers = {}                              # index -> (verb, arg)
    turn_of = []
    turn = -1
    for i, s in enumerate(ss):
        if s['kind'] == 'prompt':
            turn += 1
            asked_for |= set(IDENT.findall(s['text'])) | {w for c in re.findall(r'`([^`\n]{1,80})`', s['text'])
                                                          for w in re.findall(r'[A-Za-z_]\w{2,}', c)}
        turn_of.append(turn)
        a = answer_of(s)
        if a:
            answers[i] = a
            verb = a[0]
            # what this call and the calls sent with it name, the agent named before it saw the answer
            for f in paths_in(' '.join(json.dumps(x['input'], ensure_ascii=False) for x in _batch(ss, i)), root):
                seen_full.add(f)
                seen_base.add(f.rsplit('/', 1)[-1])
            res = s['result'] or ''
            # the name asked about is on every caller's line by construction; the task naming it is no lead to its callers
            lead = asked_for - {w for x in re.findall(r'[\w.]+', a[1]) for w in (x, *x.split('.'))}
            led = set()
            for ln in res.splitlines():
                if lead & {w for x in IDENT.findall(ln) for w in (x, *x.split('.'))}:
                    led |= {norm(g.group(1), root) for g in PATH.finditer(ln)}
            for m in (ROW.finditer(s['result'] or '') if mixed(s) else PATH.finditer(s['result'] or '')):
                after = (s['result'] or '')[m.end():m.end() + 2]
                if not PLACE.search(m.group(0) + after):
                    continue                      # a bare file name (a listing, prose) is not a place the answer gave
                if verb == 'note' and not re.match(r':\d', after):
                    continue                      # a note nobody asked for credits a place (file:line), not a file summary
                f = norm(m.group(1), root)
                if not f:
                    continue
                if f in led:
                    continue                  # the task already named what a row on this file is about: its lead
                b = f.rsplit('/', 1)[-1]
                if f in seen_full or f in first or (not GENERIC.match(b) and b in seen_base):
                    continue
                if any(_same(f, g) for g in seen_full):
                    continue
                first[f] = i
        for f in paths_in(_seen_text(s), root):
            seen_full.add(f)
            seen_base.add(f.rsplit('/', 1)[-1])

    acts = [(i, k, fs) for i, s in enumerate(ss) for k, fs in touched(s, root)]
    # j acted on the answer at i only when it was sent after i's answer came back, not alongside the call
    sent_after = lambda j, i: j > i and not (ss[i].get('mid') and ss[j].get('mid') == ss[i].get('mid'))
    edits_at = {j for j, k, fs in acts if k == 'edit'}
    ids = lambda js: [ss[j]['id'] for j in js]
    out = []
    claimed = set()                           # (test run, test file): a run is credited to the first answer that picked it
    for i, (verb, arg) in sorted(answers.items()):
        shown = sorted(f for f, j in first.items() if j == i)
        named = paths_in(ss[i]['result'], root)
        # the tests an answer picked: every test file a test verb names (picking them is its job); for the other verbs
        # only a test file first seen in it, since a test the agent already knew of was not picked by the answer
        tests_named = {f for f in named if TEST_FILE.search(f) and (verb in ('tests', 'test-impact') or f in shown)}
        # one file named twice (`test_x.py` in a run line, `tests/test_x.py` in a row) is one test file
        tests_named = {f for f in tests_named if not any(g != f and g.endswith('/' + f) for g in tests_named)}
        read, edited, ev_read, ev_edit = [], [], [], []
        for f in shown:
            r = [j for j, k, fs in acts if k == 'read' and sent_after(j, i) and _hit(f, fs)]
            e = [j for j, k, fs in acts if k == 'edit' and sent_after(j, i) and _hit(f, fs)]
            kept = diff is None or _hit(f, diff)
            if e and kept:
                edited.append(f); ev_edit += e; ev_read += r
            elif r or e:
                read.append(f); ev_read += r or e
        # the answer's picked tests: a later test command that names one of them
        ran, passed, ev_test = set(), set(), []
        for j, k, fs in acts:
            if k == 'test' and sent_after(j, i):
                hit = {t for t in tests_named if _hit(t, fs) and (j, t) not in claimed}
                claimed |= {(j, t) for t in hit}
                if hit:
                    ev_test.append(j)
                ran |= hit
                said = ss[j]['result'] or ''
                if not ss[j]['error'] and PASSED.search(said) and not FAILED.search(said) and not BROKE.search(said):
                    passed |= hit
                else:
                    passed -= hit             # a test file passes when its latest run does
        passed_all = bool(ran) and ran == passed
        if edited or (ran and passed_all and verb in ('tests', 'test-impact')):
            label = 'Helped'
        elif read or ran:
            label = 'Useful'
        else:
            continue
        frm, ev_from = [], []
        if edited:
            # the search the answer ended: files read or edited since the prompt or the last edit before the answer,
            # never touched again and not in the final diff
            start = i
            while start > 0 and ss[start - 1]['kind'] != 'prompt' and (start - 1) not in edits_at:
                start -= 1
            before, hits = {}, {}
            for j, k, fs in (a for a in acts if start <= a[0] < i):
                if k in ('read', 'edit'):
                    for f in fs:
                        before.setdefault(f, j)
                        hits[f] = hits.get(f, 0) + 1
            later = set()
            for s2 in ss[i + 1:]:
                if s2['kind'] == 'call':
                    later |= paths_in(json.dumps(s2['input'], ensure_ascii=False), root)
            frm = sorted(p for p in before if not _hit(p, shown) and not _hit(p, later)
                         and (diff is None or not _hit(p, diff)) and not _hit(p, named))
            ev_from = sorted({before[p] for p in frm})
            # a redirect is work that was going somewhere else: two or more files dropped, or one gone back to, and the
            # change landing in code (updating the tests an answer listed is help, not a change of direction)
            if frm and (len(frm) > 1 or hits[frm[0]] > 1) and any(not TEST_FILE.search(f) for f in edited):
                label = 'Redirected'
            else:
                frm, ev_from = [], []
        out.append({'answer': ss[i]['id'], 'turn': turn_of[i], 'ts': ss[i]['ts'], 'verb': verb, 'arg': arg[:160],
                    'label': label, 'shown': len(shown), 'edited': edited, 'read': read, 'from': frm,
                    'tests_ran': len(ran), 'tests_passed': len(passed), 'tests': sorted(ran),
                    'tests_failed': sorted(ran - passed),
                    # the tool calls each link stands on, by the host's id, so every chain can be checked by hand
                    'evidence': {'answer': ss[i]['id'], 'from': ids(ev_from), 'read': ids(sorted(set(ev_read))),
                                 'edit': ids(sorted(set(ev_edit))), 'test': ids(ev_test)},
                    # the same links as the session shows them, in order, for a reader to inspect
                    'trail': _trail(ss, root, i, edited + read, ev_from, ev_read, ev_edit, ev_test)})
    return out


def _trail(ss, root, i, files, ev_from, ev_read, ev_edit, ev_test):
    """[{n, kind, text, out}]: the answer (with its rows on the credited files) and each later call a link stands on"""
    def brief(s, kind=''):
        inp = s['input']
        if kind == 'edit' and s['name'] not in EDIT_TOOLS:
            w = written(str(inp.get('command') or ''), root)
            return 'shell edit of ' + ', '.join(sorted(w)) if w else 'shell edit'
        if s['name'] in EDIT_TOOLS or s['name'] in READ_TOOLS:
            return f"{s['name']} {_source(inp.get('file_path') or inp.get('path') or '', root)}"
        c = str(inp.get('command') or json.dumps(inp, ensure_ascii=False))
        return re.sub(r'^cd \S+\s*(?:&&|;)\s*', '', c).strip().splitlines()[0][:160] if c.strip() else s['name']
    res = ss[i]['result'] or ''
    rows = [l.rstrip() for l in res.splitlines() if any(f.rsplit('/', 1)[-1] in l for f in files) or
            (l.lstrip()[:4] == 'run:')][:8]
    v, a = answer_of(ss[i]) or ('', '')
    out = [{'n': i, 'kind': 'answer', 'text': _q({'verb': v, 'arg': a}).strip('`'),
            'out': '\n'.join(rows)}]
    for kind, js in (('before', ev_from), ('read', ev_read), ('edit', ev_edit), ('test', ev_test)):
        for j in sorted(set(js)):
            tail = ''
            if kind == 'test':
                m = re.findall(r'(?:Tests?:|Test Files|=+)?[^\n]*\b\d+ (?:passed|failed)[^\n]*', ss[j]['result'] or '')
                tail = m[-1].strip(' =')[:160] if m else ('passed' if not ss[j]['error'] else 'failed')
            out.append({'n': j, 'kind': kind, 'text': brief(ss[j], kind), 'out': tail})
    return sorted(out, key=lambda x: x['n'])


def working_diff(root):
    try:
        r = subprocess.run(['git', '-C', root, 'status', '--porcelain', '--untracked-files=all'],
                           capture_output=True, text=True, timeout=10)
    except Exception:
        return None
    if r.returncode:
        return None
    return {norm(l[3:].split(' -> ')[-1], root) for l in r.stdout.splitlines() if len(l) > 3}


# ---- what is printed ------------------------------------------------------------------------------------------------

NOTES = {'PostToolUse': "AxiomCode's after-edit check", 'UserPromptSubmit': "AxiomCode's note on the task"}


def _q(c):
    if c['verb'] == 'note':
        return NOTES.get(c['arg'], 'an AxiomCode note')
    # what was asked, without flags or paths (--json, an output file), and a shell loop's variable says nothing
    arg = ' '.join(w for w in c['arg'].split() if not w.startswith(('-', '/', '$', '~')))
    v = c['verb'] + (f" {arg}" if arg else '')
    return f'`{v[:70]}…`' if len(v) > 70 else f'`{v}`'


def _names(fs, n=3):
    b = [f.rsplit('/', 1)[-1] for f in fs]
    return ', '.join(b[:n]) + (f' +{len(b) - n}' if len(b) > n else '')


def _tests(c):
    """the effect of the tests an answer picked: which ran, and whether they pass"""
    n, t = c['tests_ran'], c.get('tests') or []
    if not n:
        return ''
    names = f" ({_names(t)})" if t else ''
    if c['tests_passed'] == n:
        return f" → {({1: 'its', 2: 'both'}.get(n, f'all {n}'))} picked test file{'s' if n > 1 else ''}{names} {'passes' if n == 1 else 'pass'}"
    ok = [f for f in t if f not in (c.get('tests_failed') or [])]
    return f" → picked test file{'s' if len(ok) > 1 else ''} {_names(ok)} {'pass' if len(ok) > 1 else 'passes'}" if ok else ""


def line(c):
    """one chain as cause → action → effect, naming the files and tests it stands on"""
    q, ed, rd = _q(c), c['edited'], c['read']
    them = lambda fs: 'it' if len(fs) == 1 else 'them'
    if c['label'] == 'Redirected':
        return (f"Redirected: the agent was in {_names(c['from'])} → {q} pointed it to {_names(ed)} directly "
                f"→ it left those and edited {them(ed)}{_tests(c)}")
    if ed:
        extra = f", read {_names(rd)}" if rd else ''
        return f"{c['label']}: {q} pointed the agent to {_names(ed)} directly, before it had come across {them(ed)} → it edited {them(ed)}{extra}{_tests(c)}"
    if rd:
        return f"{c['label']}: {q} pointed the agent to {_names(rd)} directly, before it had come across {them(rd)} → it read {them(rd)}{_tests(c)}"
    n = c['tests_ran']
    ok = 'all pass' if c['tests_passed'] == n else ''
    return (f"{c['label']}: {q} picked {n} test file{'s' if n > 1 else ''} ({_names(c.get('tests') or [])}) "
            f"→ the agent ran {'it' if n == 1 else 'them'}" + (f" → {'it passes' if n == 1 else ok}" if ok else ''))


def asked(ss):
    """the answers the session holds: [(turn, step id)]"""
    out, turn = [], -1
    for s in ss:
        if s['kind'] == 'prompt':
            turn += 1
        elif answer_of(s):
            out.append((turn, s['id']))
    return out


def _load(root):
    p = os.path.join(root, LEDGER)
    out = []
    try:
        with open(p, encoding='utf-8') as f:
            for l in f:
                try:
                    r = json.loads(l)
                except ValueError:
                    continue
                if 'answer' in r:
                    out.append(r)
    except OSError:
        pass
    return out


def new_chains(found, recorded, session):
    """the chains not printed before, or grown since: a stronger label, or a file edited that was not"""
    best = {}
    for r in recorded:
        if r.get('session') == session and 'answer' in r:
            best[r['answer']] = r
    out = []
    for c in found:
        old = best.get(c['answer'])
        if old and RANK[c['label']] <= RANK.get(old.get('label'), 0) and set(c['edited']) <= set(old.get('edited') or []):
            continue
        out.append(c)
    return out


def receipt(fresh, totals=None, turn=None, session=None):
    """`turn` / `session`: (answers asked, answers that led to work), for the count lines"""
    if not fresh:
        return ''
    fresh = sorted(fresh, key=lambda c: -RANK[c['label']])
    said = []
    for c in fresh:
        l = line(c)
        if l not in said:
            said.append(l)
    head = '◆ AxiomCode this turn'
    if turn and turn[1]:
        head += f" · the agent acted on {turn[1]} answer{'s' if turn[1] > 1 else ''}"
    earlier = len({c['answer'] for c in fresh} - set(turn[2] if turn and len(turn) > 2 else []))
    if turn and earlier:
        head += (', and ' if turn[1] else ' · ') + f"{earlier} earlier answer{'s' if earlier > 1 else ''} went further"
    lines = [head] + [f'  • {l}' for l in said[:5]]
    if len(said) > 5:
        lines.append(f'  • and {len(said) - 5} more (axiomcode report)')
    if totals and session and session[1] > len({c['answer'] for c in fresh}):
        t = totals
        lines.append(f"  session: the agent acted on {session[1]} answer{'s' if session[1] > 1 else ''} · " + ', '.join(
            f'{t[k]} {k}' for k in ('Redirected', 'Helped', 'Useful') if t.get(k))
            + (f" · {t['_edited']} file{'s' if t['_edited'] > 1 else ''} edited from them" if t.get('_edited') else '')
            + (f" · {t['_tests']} picked test file{'s' if t['_tests'] > 1 else ''} run" if t.get('_tests') else ''))
    return '\n'.join(lines)


def record(root, session, fresh):
    p = os.path.join(root, LEDGER)
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'a', encoding='utf-8') as f:
            for c in fresh:
                f.write(json.dumps(dict(c, session=session, repo=os.path.basename(root.rstrip('/')),
                                        at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))) + '\n')
    except OSError:
        pass


def _best(recorded, session=None):
    """each answer's strongest recorded chain"""
    best = {}
    for r in recorded:
        if 'answer' in r and (session is None or r.get('session') == session):
            k = (r.get('session'), r['answer'])
            if k not in best or RANK.get(r['label'], 0) >= RANK.get(best[k]['label'], 0):
                best[k] = r
    return best


def totals(recorded, session):
    """labels per answer, plus `_edited` (files edited from an answer) and `_tests` (picked test files run)"""
    t, edited, tests = {}, set(), set()
    for r in _best(recorded, session).values():
        t[r['label']] = t.get(r['label'], 0) + 1
    for r in recorded:
        if r.get('session') == session and 'answer' in r:
            edited |= set(r.get('edited') or [])
            tests |= set(r.get('tests') or [])
    if edited:
        t['_edited'] = len(edited)
    if tests:
        t['_tests'] = len(tests)
    return t


def at_stop(transcript, root, session):
    """the receipt for the turn that just ended, recorded; '' when there is nothing new"""
    ss = steps(transcript)
    found = chains(ss, root, working_diff(root))
    recorded = _load(root)
    fresh = new_chains(found, recorded, session)
    q = asked(ss)
    last = sum(1 for s in ss if s['kind'] == 'prompt') - 1
    record(root, session, fresh)
    if not fresh:
        return ''
    led = {c['answer'] for c in found}
    now = [i for t, i in q if t == last]
    msg = receipt(fresh, totals(recorded + [dict(c, session=session) for c in fresh], session),
                  turn=(len(now), len(led & set(now)), now), session=(len(q), len(led)))
    try:
        # the page is rebuilt whenever the ledger grows, so it is current without anyone asking for it
        page, _ = report(root)
        msg += f'\n  report: file://{page}'
    except Exception:
        pass
    return msg


# ---- the report -----------------------------------------------------------------------------------------------------

CSS = """
:root{--bg:#fafaf8;--fg:#1b1b19;--mut:#66655f;--card:#fff;--line:#e5e3dd;--soft:#f2f1ec;--acc:#2f6fed;--ok:#127a55;--r:#7a3df0;--u:#8a6d1f}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121211;--fg:#ecebe6;--mut:#a3a29c;--card:#1b1b1a;--line:#302f2c;--soft:#22221f;--acc:#7aa5ff;--ok:#4fd1a1;--r:#b394ff;--u:#e0c063}}
:root[data-theme=dark]{--bg:#121211;--fg:#ecebe6;--mut:#a3a29c;--card:#1b1b1a;--line:#302f2c;--soft:#22221f;--acc:#7aa5ff;--ok:#4fd1a1;--r:#b394ff;--u:#e0c063}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,system-ui,sans-serif}
main{max-width:940px;margin:0 auto;padding:40px 16px 80px}
code,pre{font:12.5px/1.5 ui-monospace,Menlo,monospace}pre{white-space:pre-wrap;word-break:break-word;margin:6px 0 0;padding:8px 10px;background:var(--soft);border-radius:6px}
.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--acc);font-weight:700}
h1{font-size:34px;line-height:1.15;margin:8px 0 12px;letter-spacing:-.01em}h2{font-size:21px;margin:0 0 4px}
.sec{margin-top:56px}.num{color:var(--mut);font-size:13px;font-weight:600;letter-spacing:.06em}
.lede{font-size:18px;color:var(--fg);max-width:720px;margin:0 0 24px}.sub{color:var(--mut);margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}.tile b{display:block;font-size:34px;line-height:1.1}
.tile span{color:var(--mut);font-size:13.5px}.verified{margin-top:14px;font-size:13.5px;color:var(--ok);font-weight:600}
.cap{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}.cap b{font-size:26px;color:var(--acc)}
.cap h3{margin:4px 0 6px;font-size:16px}.cap p{margin:0;color:var(--mut);font-size:14px}
.case{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:14px 0}
.case .top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline}
.case .repo{font-size:18px;font-weight:700}.case .q{color:var(--mut);font-size:13.5px}
.badge{font-size:12px;font-weight:700;padding:3px 9px;border-radius:99px;background:var(--soft);color:var(--ok);white-space:nowrap}
.tl{list-style:none;margin:14px 0 0;padding:0;counter-reset:s}.tl li{position:relative;padding:0 0 14px 34px;counter-increment:s}
.tl li:before{content:counter(s);position:absolute;left:0;top:0;width:22px;height:22px;border-radius:50%;background:var(--acc);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
.tl li:after{content:"";position:absolute;left:10.5px;top:24px;bottom:2px;width:1px;background:var(--line)}.tl li:last-child:after{display:none}
.tl .t{font-weight:600}.tl .d{color:var(--mut);font-size:13.5px}.files{margin:4px 0 0;padding:0;list-style:none}.files li{padding:0!important;counter-increment:none}.files li:before,.files li:after{display:none}
.pass{color:var(--ok);font-weight:600;font-size:13px}.outcome{margin-top:6px;padding:12px 14px;border-left:3px solid var(--ok);background:var(--soft);border-radius:0 8px 8px 0;font-size:14.5px}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:8px 0}summary{cursor:pointer;padding:12px 14px;list-style:none}
summary::-webkit-details-marker{display:none}summary .l{font-size:12px;font-weight:700;margin-right:8px}.Redirected{color:var(--r)}.Helped{color:var(--ok)}.Useful{color:var(--u)}
details .body{padding:0 14px 14px}.ev{border-top:1px solid var(--line);padding:8px 0}.ev .k{display:inline-block;min-width:74px;font-size:12px;font-weight:700;color:var(--mut);text-transform:uppercase}
.ev .n{color:var(--mut);font-size:12px;margin-right:6px}.filters{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.filters button{font:inherit;font-size:13px;padding:5px 12px;border-radius:99px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
.filters button.on{background:var(--acc);border-color:var(--acc);color:#fff}.method{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.method h3{font-size:15px;margin:14px 0 4px}.method h3:first-child{margin-top:0}.method ul{margin:4px 0;padding-left:20px}.method p{margin:4px 0}
@media (max-width:560px){h1{font-size:27px}.tile b{font-size:28px}}
"""

KIND = {'answer': 'asked', 'before': 'before', 'read': 'read', 'edit': 'edited', 'test': 'ran tests'}


def _caps(r):
    """which of the three ways a chain shows: found files first, connected a change across files, tests run"""
    c = set()
    if r.get('edited') or r.get('read'):
        c.add('found')
    if r['verb'] in ('impact', 'path') and len((r.get('edited') or []) + (r.get('read') or [])) > 1 or \
            (r['verb'] == 'note' and r.get('arg') == 'PostToolUse') or r.get('from'):
        c.add('connected')
    if r.get('tests_passed'):
        c.add('tests')
    return c


def _score(r):
    return 4 * len(r.get('edited') or []) + len(r.get('read') or []) + min(r.get('tests_passed', 0), 3) + \
        (6 if r['label'] == 'Redirected' else 0)


def _story(r):
    """the featured timeline: what was asked, what the answer named first, what the agent then did, and what came of it"""
    e = html.escape
    ed, rd, n = r.get('edited') or [], r.get('read') or [], len(r.get('edited') or []) + len(r.get('read') or [])
    fl = lambda fs: '<ul class=files>' + ''.join(f'<li><code>{e(f)}</code></li>' for f in fs) + '</ul>'
    st = []
    if r.get('from'):
        st.append(f"<li><div class=t>The agent was working in other files</div>{fl(r['from'])}</li>")
    st.append(f"<li><div class=t>The agent queried AxiomCode</div><code>{e(_q(r).strip('`'))}</code></li>")
    if n:
        word = {1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five'}.get(n, str(n))
        st.append(f"<li><div class=t>AxiomCode identified {word} file{'s' if n > 1 else ''} the agent had not yet "
                  f"come across</div>{fl(ed + rd)}</li>")
    if ed:
        whole = len(ed) == n
        st.append(f"<li><div class=t>The agent edited {('all ' + str(len(ed)) + ' of them' if len(ed) > 2 else ('both' if len(ed) == 2 else 'it')) if whole else _names(ed)}"
                  f"{' and read ' + _names(rd) if rd else ''}</div><div class=d>The edits remained in the working tree.</div></li>")
    elif rd:
        st.append(f"<li><div class=t>The agent read {'them' if len(rd) > 1 else 'it'}</div></li>")
    if r.get('tests_ran'):
        ok = set(r.get('tests') or []) - set(r.get('tests_failed') or [])
        st.append("<li><div class=t>The agent ran the tests AxiomCode selected</div><ul class=files>" + ''.join(
            f"<li><code>{e(f.rsplit('/', 1)[-1])}</code> <span class=pass>passed</span></li>" for f in sorted(ok)) + '</ul></li>')
    out = []
    if n:
        out.append(f"AxiomCode identified {n} file{'s' if n > 1 else ''} before the agent encountered "
                   f"{'them' if n > 1 else 'it'}")
    if ed:
        out.append(f"the agent edited {('all ' + str(len(ed)) if len(ed) > 2 else ('both' if len(ed) == 2 else 'it')) if len(ed) == n else _names(ed)}"
                   + (f" and read {_names(rd)}" if rd else ''))
    elif rd:
        out.append('the agent read ' + ('them' if len(rd) > 1 else 'it'))
    if r.get('tests_passed'):
        k = r['tests_passed']
        out.append(f"then ran {k} selected test file{'s' if k > 1 else ''} successfully")
    txt = ', '.join(out)
    return '<ol class=tl>' + ''.join(st) + '</ol>' + (f"<div class=outcome><b>Observed outcome.</b> {e(txt[0].upper() + txt[1:])}.</div>" if txt else '')


def _evidence(r):
    """every link as the session record shows it, by sequence number"""
    e = html.escape
    out = []
    for x in r.get('trail') or []:
        o = f"<pre>{e(x['out'])}</pre>" if x.get('out') else ''
        out.append(f"<div class=ev><span class=n>#{x['n']}</span><span class=k>{KIND.get(x['kind'], x['kind'])}</span>"
                   f"<code>{e(x['text'])}</code>{o}</div>")
    return ''.join(out) or '<div class=ev>Evidence ids: ' + e(json.dumps(r.get('evidence'))) + '</div>'


def report(root):
    rows = sorted(_best(_load(root)).values(), key=lambda r: r.get('at') or '', reverse=True)
    e = html.escape
    sessions = {}
    for r in rows:
        sessions.setdefault(r.get('session') or '?', []).append(r)
    edited = {(r.get('session'), f) for r in _load(root) for f in r.get('edited') or []}
    tests = {(r.get('session'), f) for r in _load(root) for f in r.get('tests') or [] if f not in (r.get('tests_failed') or [])}
    ns, ne, nt = len(sessions), len({f for _, f in edited}), len({f for _, f in tests})
    caps = {k: [r for r in rows if k in _caps(r)] for k in ('found', 'connected', 'tests')}
    pl = lambda n, w: f"{n} {w}{'s' if n != 1 else ''}"
    body = [f"<div class=num>01</div><div class=eyebrow>AxiomCode · agent impact report</div><h1>From code understanding to verified agent actions.</h1>"
            f"<p class=lede>Across {pl(ns, 'coding session')}, AxiomCode identified files agents had not yet explored, "
            f"guided the edits that followed, and selected tests the agents ran and passed.</p><div class=grid>"]
    for v, k in ((ns, 'Coding sessions'), (len(rows), 'Answers the agent acted on'), (ne, 'Previously unseen files edited'),
                 (nt, 'Selected test files passing')):
        if v:
            body.append(f"<div class=tile><b>{v}</b><span>{k}</span></div>")
    body.append("</div><div class=verified>✓ Verified against recorded agent actions, not agent self-reports.</div>")

    body.append("<section class=sec><div class=num>02</div><h2>How AxiomCode influenced agent behavior</h2>"
                "<p class=sub>Each answer below is counted under every way it showed.</p><div class=grid>")
    for k, t, d in (('found', 'Found relevant files before the agent discovered them',
                     'AxiomCode named code locations the agent had not yet encountered; the agent then inspected or edited them.'),
                    ('connected', 'Connected changes across the codebase',
                     'Impact and path answers, and the check after each edit, named related implementation files and tests, '
                     'moving the agent beyond where it started.'),
                    ('tests', 'Turned analysis into test execution',
                     'Agents ran the tests AxiomCode selected, and those runs passed.')):
        if caps[k]:
            body.append(f"<div class=cap><b>{len(caps[k])}</b><h3>{t}</h3><p>{d}</p></div>")
    body.append('</div></section>')

    feat, seen = [], set()
    for r in sorted(rows, key=_score, reverse=True):
        if r.get('session') in seen or not (r.get('edited') or r.get('read')):
            continue
        feat.append(r); seen.add(r.get('session'))
        if len(feat) == 3:
            break
    if feat:
        body.append("<section class=sec><div class=num>03</div><h2>Featured evidence</h2>"
                    "<p class=sub>The strongest chains, each read step by step from the session record.</p>")
        for r in feat:
            badge = 'Observed edit + tests passed' if r.get('edited') and r.get('tests_passed') else (
                'Observed edit' if r.get('edited') else 'Observed read')
            body.append(f"<div class=case><div class=top><div><div class=repo>{e(r.get('repo') or '')}</div>"
                        f"<div class=q>{e({'impact': 'Impact analysis', 'path': 'Call path', 'context': 'Code context', 'tests': 'Test selection', 'note': 'Graph note'}.get(r['verb'], r['verb']))}"
                        f" · <code>{e(_q(r).strip('`'))}</code></div></div><span class=badge>{badge}</span></div>{_story(r)}"
                        f"<details><summary>Show the recorded actions</summary><div class=body>{_evidence(r)}</div></details></div>")
        body.append('</section>')

    body.append("<section class=sec><div class=num>04</div><h2>All verified sessions</h2>"
                "<p class=sub>Open any answer to see the query, AxiomCode's rows, and each later action with its sequence "
                "number in the session.</p><div class=filters>"
                "<button class=on data-f=all>All</button><button data-f=edited>Edits</button><button data-f=read>Reads</button>"
                "<button data-f=tests>Tests passed</button></div>")
    for s, rs in sessions.items():
        for r in rs:
            tags = ' '.join(t for t, ok in (('edited', r.get('edited')), ('read', r.get('read')), ('tests', r.get('tests_passed'))) if ok)
            body.append(f"<details data-t='{tags}'><summary><span class='l {r['label']}'>{r['label']}</span>"
                        f"<b>{e(r.get('repo') or s[:8])}</b> · "
                        f"{re.sub(r'`([^`]+)`', r'<code>\1</code>', e(line(r).split(': ', 1)[1]))}</summary>"
                        f"<div class=body>{_evidence(r)}</div></details>")
    body.append('</section>')

    body.append("""<section class=sec><div class=num>05</div><h2>Measured from agent actions, not agent claims</h2>
<div class=method><h3>An answer is credited only when all of these hold in the session record</h3><ul>
<li>The AxiomCode answer named a file (as a place: a path or <code>file:line</code>) before any earlier prompt, tool call,
tool output or reply had named it.</li>
<li>The task had not already named what that row is about; a function the issue names is the task's lead, not AxiomCode's.</li>
<li>Afterwards the agent read or edited that file, or ran a test file the answer selected.</li>
<li>Edits are confirmed in the working tree when the turn ends; test runs and their results come from the tool output.</li></ul>
<h3>Labels are assigned mechanically</h3><ul>
<li><b class=Helped>Helped</b>: a file the answer named first was edited and the edit was kept, or the tests a test-selection
answer picked ran and passed.</li>
<li><b class=Useful>Useful</b>: a file the answer named first was read, or tests it picked were run, without an edit from it.</li>
<li><b class=Redirected>Redirected</b>: Helped, and before the answer the agent had been reading or editing two or more other files
that it never returned to and did not change.</li></ul>
<h3>Scope</h3><p>This report shows that AxiomCode's answers were followed by these agent actions. It does not measure what the
agent would have done without them, or whether the edits were correct; a passing test supports only that the selected test
run passed.</p></div></section>""")
    js = ("<script>document.querySelectorAll('.filters button').forEach(b=>b.onclick=()=>{"
          "document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('on',x===b));const f=b.dataset.f;"
          "document.querySelectorAll('details[data-t]').forEach(d=>d.style.display=(f==='all'||d.dataset.t.split(' ').includes(f))?'':'none')})</script>")
    page = (f"<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>Agent Impact Report</title><style>{CSS}</style></head><body><main>{''.join(body)}</main>{js}</body></html>")
    out = os.path.join(root, '.axiomcode', 'assists.html')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(page)
    return out, len(rows)


def replay(transcript, root):
    """what each turn of a past session would have printed (the working tree then is not known: an edit counts as kept)"""
    ss = steps(transcript)
    ends = [i for i, s in enumerate(ss) if s['kind'] == 'prompt'][1:] + [len(ss)]
    recorded, n = [], 0
    for e in ends:
        n += 1
        fresh = new_chains(chains(ss[:e], root, None), recorded, 'replay')
        recorded += [dict(c, session='replay') for c in fresh]
        q = asked(ss[:e])
        led = {c['answer'] for c in recorded}
        now = [i for t, i in q if t == n - 1]
        r = receipt(fresh, totals(recorded, 'replay'), turn=(len(now), len(led & set(now)), now), session=(len(q), len(led)))
        if r:
            print(f'--- turn {n}\n{r}')
    return recorded


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['report']:
        p, n = report(os.path.abspath(a[1] if len(a) > 1 else '.'))
        print(f'{n} chain(s) → {p}')
    elif a[:1] == ['replay'] and len(a) > 1:
        rec = replay(a[1], os.path.abspath(a[2] if len(a) > 2 else '.'))
        t = {}
        for r in rec:
            t[r['label']] = t.get(r['label'], 0) + 1
        print('total:', json.dumps(t))
    else:
        print(__doc__.strip().splitlines()[-2:][0]); print(__doc__.strip().splitlines()[-1]); sys.exit(2)
