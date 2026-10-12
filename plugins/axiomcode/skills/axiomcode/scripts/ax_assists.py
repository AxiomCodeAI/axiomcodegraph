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
TEST_FILE = re.compile(r'(?:^|/)(?:tests?|__tests__|spec|specs)/|(?:^|/)test_[^/]+$|_test\.\w+$|\.(?:test|spec)\.\w+$|'
                       r'Tests?\.(?:java|kt|cs|scala)$|IT\.java$')
TEST_RUN = re.compile(r'(?:^|[\s;&|(])(?:pytest|py\.test|tox|nox|jest|vitest|mocha|ava|tap|go\s+test|cargo\s+test|'
                      r'dotnet\s+test|mvn\b[^;&|]*\b(?:test|verify)\b|mvnw\b[^;&|]*\b(?:test|verify)\b|gradlew?\b[^;&|]*\btest\b|'
                      r'(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|python3?\s+-m\s+(?:pytest|unittest))')
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
                    out.append({'kind': 'prompt' if real else 'note', 'text': t, 'ts': ts})
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
                    s = {'kind': 'call', 'id': x.get('id'), 'name': x.get('name') or '', 'input': x.get('input') or {},
                         'result': '', 'error': False, 'ts': ts}
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
        if answer_of(s):
            return []
        w = written(cmd, root)
        if w:
            out.append(('edit', w))
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

def chains(ss, root, diff=None):
    """every chain the session holds. `diff`: the files changed in the working tree now (None: not known, an edit
    counts as kept)."""
    seen_full, seen_base = set(), set()
    first = {}                                # file -> index of the answer that first showed it
    answers = {}                              # index -> (verb, arg)
    turn_of = []
    turn = -1
    for i, s in enumerate(ss):
        if s['kind'] == 'prompt':
            turn += 1
        turn_of.append(turn)
        a = answer_of(s)
        if a:
            answers[i] = a
            for f in paths_in(json.dumps(s['input'], ensure_ascii=False), root):
                seen_full.add(f)
                seen_base.add(f.rsplit('/', 1)[-1])
            for m in (ROW.finditer(s['result'] or '') if mixed(s) else PATH.finditer(s['result'] or '')):
                if not PLACE.search(m.group(0) + (s['result'] or '')[m.end():m.end() + 2]):
                    continue                      # a bare file name (a listing, prose) is not a place the answer gave
                f = norm(m.group(1), root)
                if not f:
                    continue
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
        read, edited, ev_read, ev_edit = [], [], [], []
        for f in shown:
            r = [j for j, k, fs in acts if k == 'read' and j > i and _hit(f, fs)]
            e = [j for j, k, fs in acts if k == 'edit' and j > i and _hit(f, fs)]
            kept = diff is None or _hit(f, diff)
            if e and kept:
                edited.append(f); ev_edit += e; ev_read += r
            elif r or e:
                read.append(f); ev_read += r or e
        # the answer's picked tests: a later test command that names one of them
        ran, passed, ev_test = set(), set(), []
        for j, k, fs in acts:
            if k == 'test' and j > i:
                hit = {t for t in tests_named if _hit(t, fs) and (j, t) not in claimed}
                claimed |= {(j, t) for t in hit}
                if hit:
                    ev_test.append(j)
                ran |= hit
                if not ss[j]['error']:
                    passed |= hit
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
                                 'edit': ids(sorted(set(ev_edit))), 'test': ids(ev_test)}})
    return out


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

def _q(c):
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
        return (f"Redirected: the agent was in {_names(c['from'])} → {q} showed {_names(ed)} (new to it) "
                f"→ it left those and edited {them(ed)}{_tests(c)}")
    if ed:
        extra = f", read {_names(rd)}" if rd else ''
        return f"{c['label']}: {q} showed {_names(ed)} (new to the agent) → it edited {them(ed)}{extra}{_tests(c)}"
    if rd:
        return f"{c['label']}: {q} showed {_names(rd)} (new to the agent) → it read {them(rd)}{_tests(c)}"
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
        head += f" · {turn[1]} answer{'s' if turn[1] > 1 else ''} led the agent's work"
    earlier = len({c['answer'] for c in fresh} - set(turn[2] if turn and len(turn) > 2 else []))
    if turn and earlier:
        head += (', and ' if turn[1] else ' · ') + f"{earlier} earlier answer{'s' if earlier > 1 else ''} went further"
    lines = [head] + [f'  • {l}' for l in said[:5]]
    if len(said) > 5:
        lines.append(f'  • and {len(said) - 5} more (axiomcode report)')
    if totals and session and session[1] > len({c['answer'] for c in fresh}):
        t = totals
        lines.append(f"  session: {session[1]} answer{'s' if session[1] > 1 else ''} led the work · " + ', '.join(
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
                f.write(json.dumps(dict(c, session=session, at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))) + '\n')
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
    return receipt(fresh, totals(recorded + [dict(c, session=session) for c in fresh], session),
                   turn=(len(now), len(led & set(now)), now), session=(len(q), len(led)))


# ---- the report -----------------------------------------------------------------------------------------------------

CSS = """
:root{--bg:#fbfbfa;--fg:#1d1d1b;--mut:#6b6a66;--card:#fff;--line:#e6e4df;--r:#7a3df0;--h:#127a55;--u:#8a6d1f}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--mut:#a3a29c;--card:#1d1d1b;--line:#33322f;--r:#b394ff;--h:#4fd1a1;--u:#e0c063}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mut);margin:0 0 24px}
.tiles{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:28px}
.tile{flex:1;min-width:140px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
.tile b{display:block;font-size:28px}.tile span{color:var(--mut);font-size:13px}
.s{margin:28px 0 8px;color:var(--mut);font-size:13px;text-transform:uppercase;letter-spacing:.04em}
.c{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:8px 0}
.l{font-weight:600;font-size:13px}.Redirected{color:var(--r)}.Helped{color:var(--h)}.Useful{color:var(--u)}
.c p{margin:4px 0 0}.c ol{margin:6px 0 0;padding-left:20px;color:var(--mut);font-size:13px}.c ol b{color:var(--fg);font-weight:600}.tile small{font-size:14px;color:var(--mut)}.c small{color:var(--mut)}code{font:13px ui-monospace,Menlo,monospace}
"""


def _steps_html(r):
    """a chain as its links, each one checkable: what the answer gave, what the agent did, what came of it"""
    e = html.escape
    out = [f"<li><b>asked</b> <code>{e(_q(r).strip('`'))}</code></li>"]
    if r.get('from'):
        out.append(f"<li><b>before</b> the agent was in {e(', '.join(r['from']))}</li>")
    gave = (r.get('edited') or []) + (r.get('read') or [])
    if gave:
        out.append(f"<li><b>showed</b> {e(', '.join(gave))}, new to the agent</li>")
    if r.get('edited'):
        out.append(f"<li><b>edited</b> {e(', '.join(r['edited']))} (kept in the working tree)</li>")
    if r.get('read'):
        out.append(f"<li><b>read</b> {e(', '.join(r['read']))}</li>")
    if r.get('tests_ran'):
        t = ', '.join(r.get('tests') or []) or f"{r['tests_ran']} file(s)"
        ok = r['tests_passed'] == r['tests_ran']
        out.append(f"<li><b>ran</b> the picked tests {e(t)}" + (" → all pass" if ok else '') + "</li>")
    return '<ol>' + ''.join(out) + '</ol>'


def report(root):
    rows = sorted(_best(_load(root)).values(), key=lambda r: r.get('at') or '', reverse=True)
    t = {}
    for r in rows:
        t[r['label']] = t.get(r['label'], 0) + 1
    sessions = {}
    for r in rows:
        sessions.setdefault(r.get('session') or '?', []).append(r)
    edited = {(r.get('session'), f) for r in _load(root) for f in r.get('edited') or []}
    tests = {(r.get('session'), f) for r in _load(root) for f in r.get('tests') or [] if f not in (r.get('tests_failed') or [])}
    e = html.escape
    body = [f"<h1>Where AxiomCode helped</h1><p class=sub>{e(os.path.basename(os.path.abspath(root)))} · "
            f"{len(sessions)} session(s). Every line is read from the session record, not from what the agent wrote: "
            "an answer named a file the agent had not seen, and the agent then read or changed it, or ran the tests it "
            "picked.</p><div class=tiles>"]
    for v, k in ((len(rows), 'answers that led the agent\'s work'),
                 (len({f for _, f in edited}), 'files edited that an answer showed first'),
                 (len({f for _, f in tests}), 'test files it picked, run and passing')):
        if v:
            body.append(f"<div class=tile><b>{v}</b><span>{k}</span></div>")
    body.append('</div><div class=tiles>')
    for k in ('Redirected', 'Helped', 'Useful'):
        if t.get(k):                              # only what happened: a label no chain earned is not shown
            body.append(f"<div class=tile><b class={k}>{t[k]}</b><span>{k}</span></div>")
    body.append('</div>')
    for s, rs in sessions.items():
        body.append(f"<div class=s>session {e(s[:8])} · {e((rs[-1].get('at') or '')[:16].replace('T', ' '))}"
                    + f" · {len(rs)} answer{'s' if len(rs) > 1 else ''} led the work</div>")
        for r in rs:
            body.append(f"<div class=c><span class='l {r['label']}'>{r['label']}</span>"
                        f"<p>{re.sub(r'`([^`]+)`', r'<code>\1</code>', e(line(r).split(': ', 1)[1]))}</p>"
                        f"{_steps_html(r)}</div>")
    page = (f"<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>AxiomCode assists</title><style>{CSS}</style></head><body><main>{''.join(body)}</main></body></html>")
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
