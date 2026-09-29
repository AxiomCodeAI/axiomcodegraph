#!/usr/bin/env python3
"""PostToolUse on Read / Grep: the agent used its own action; the graph adds what it knows about what came back, for free.
  Read  <file> [offset, limit]  → for the callables declared in the lines read, the edges the text cannot show: callers and
                                 callees in other files or in this file outside the range (with their line), overrides in
                                 other files or in this file's inner / enum classes, unresolved calls. Counts by default,
                                 names for 1–3 callers or when the other end was read earlier this session (★, first);
                                 the rest as one `+N more` line. ≤ 6 lines
  Grep  <pattern>               → when the pattern is an identifier: its declarations, with callers and callees

Short on purpose (≤ 10 lines, names not bodies): the transcripts showed pasted context makes runs longer, so this says only
what a graph knows and a file does not — the edges. Nothing when the repo has no graph, or the read is not source."""
import collections, json, os, re, sqlite3, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts'))
import graph_sql, ax_contract as _ax
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _host, _graphline, _where

ev = _host.read(); tool = ev.get('tool_name', ''); inp = ev.get('tool_input', {}) or {}; scwd = ev.get('cwd') or os.getcwd()
# THE GRAPH IS FOUND FROM WHAT THE TOOL TOUCHED, not from the session's working directory: an agent reads and greps
# indexed trees by absolute path from a directory that has no graph (308 of 309 measured sessions), and a hook that
# looked only in the working directory never spoke. `cwd` below is the repository ROOT whose graph answers; `scwd` is
# where the session is, which a relative path in the tool's input is relative to.
cwd = _where.locate(tool, inp, scwd, ev.get('session_id'))
if not cwd: sys.exit(0)
_file = next((p for p in _where.touched(tool, inp, scwd) if os.path.isfile(p)), None)
os.environ.update(_where.lang_env(cwd, _file))          # a file in a language with its own graph is answered from it
def rel_of(fp):
    """the graph stores repo-relative paths; the tool's file_path may reach the tree through a symlink while cwd is resolved (or the
    reverse) — compare real paths, and if the file still is not under the tree, fall back to the graph's own suffix match"""
    fp = str(fp)
    for a, b in ((fp, cwd), (os.path.realpath(fp), os.path.realpath(cwd)), (os.path.realpath(fp), cwd), (fp, os.path.realpath(cwd))):
        try: r = os.path.relpath(a, b)
        except ValueError: continue                                 # Windows: a file on another drive is not under the tree
        if not r.startswith('..'): return r.replace(os.sep, '/')   # the index stores '/' on every platform
    return fp
db = _where.graph_db(cwd, _file)
if not os.path.exists(db): sys.exit(0)
con = sqlite3.connect(db); con.row_factory = sqlite3.Row
q = lambda s, *p: con.execute(s, p).fetchall()
if not q("SELECT 1 FROM sqlite_master WHERE name='symbols'"): sys.exit(0)

# What is this session actually trying to do? Written once by the orientation hook. Everything below ranked
# declarations by degree -- callers plus unresolved calls -- which answers "which of these is most connected"
# when the question was "which of these is about my task". In a measured run the agent opened the right file
# six times, and the one function its fix needed was listed last in an overflow line behind two that were not
# in the fix at all, because those two had more edges.
TASK = []
try:
    # _ax is imported at module level beside graph_sql, NOT here: it is used on the main output path
    # (is_synthetic) and task.txt is optional, so binding it inside this try made every enrichment depend
    # on an optional file being present -- absent, the open() raised and the name was never bound (#1035).
    _t = open(os.path.join(cwd, '.axiomcode', 'task.txt')).read()
    TASK = _ax.task_terms(_ax.task_text(_t))[:40]
except Exception:
    TASK = []
_TSET = set(TASK)

def task_hits(display):
    """Which of the task's words this declaration's name carries."""
    if not _TSET: return []
    try: toks = set(_ax.subtokens(display or ''))
    except Exception: return []
    out = [t for t in TASK if t in toks or any(x.startswith(t) and len(t) >= 4 for x in toks)]
    return out[:2]

# where the agent IS: the callables it read most recently (per session, last 6 reads). A later grep for a common name is
# read against them — the `close` that the method you were just reading calls is the one you mean
STATE = os.path.join(cwd, '.axiomcode', f"hooks-state-{ev.get('session_id', 'x')}.json")
def load_state():
    try: return json.load(open(STATE))
    except Exception: return {'reads': []}
def save_state(st):
    try: json.dump(st, open(STATE, 'w'))
    except OSError: pass

# A GRAPH ANSWER THE AGENT ALREADY HAS IS NOT REPEATED. `context` / `path` / `impact` print the declarations they are about
# as `file:line`; a Read of one of them right after would get the same callers and callees again as a `graph:` block. Those
# declarations are marked annotated, so a later block carries only what the answer did not. Nothing is emitted here.
_cmd = str(inp.get('command', '')) if tool == 'Bash' else ''
_from_shell = False                                           # a grep run through Bash: matched as whole names only
if tool.startswith('mcp__plugin_axiomcode_') or re.match(r'\s*(?:\S*/)?axiomcode(?:-\w+)?\s+(context|path|impact|changed|test-impact)\b', _cmd):
    text = json.dumps(ev.get('tool_response', ''))
    locs = set(re.findall(r'([\w./-]+\.\w+):(\d+)', text))
    ids = []
    for f, ln in locs:
        ids += [r['id'] for r in q("SELECT id FROM symbols WHERE (file = ? OR file LIKE ?) AND line = ? AND method_id IS NOT NULL", f, '%/' + f.lstrip('/'), int(ln))]
    if ids:
        st = load_state(); st['annotated_ids'] = list(dict.fromkeys(st.get('annotated_ids', []) + ids)); save_state(st)
    sys.exit(0)

# a grep / sed / cat run through Bash is the same action — in a session where the Grep tool is deferred, that is what the agent does
if tool == 'Bash':
    c = str(inp.get('command', ''))
    m = re.search(r'\b(?:grep|rg|ag|git\s+grep)\b((?:\s+-[-\w=]+)*)\s+(?:-e\s+)?([\'"]?)(.+?)\2(?:\s|$)', c)
    # a search of ANOTHER tree says nothing about this graph: whatever it names is a same-named stranger here.
    # The tree searched is where the shell is (a `cd` before the grep) and the paths given after the pattern.
    if m:
        import shlex
        base, _ = _where.bash_where(c[:m.start()], scwd)          # where the shell is when the grep runs (a `cd` first)
        def outside(p):
            r = os.path.relpath(os.path.realpath(_where._abs(p, base)), os.path.realpath(cwd))
            return r == '..' or r.startswith('..' + os.sep)
        try: rest = shlex.split(c[m.end():].split('|')[0].split('&&')[0].split(';')[0])
        except ValueError: rest = []
        where = [a for a in rest if not a.startswith('-') and ('/' in a or a.startswith(('~', '.')))]
        if outside(base) or any(outside(a) for a in where): sys.exit(0)
        # A GREP THAT IS NOT A CODE SEARCH SAYS NOTHING ABOUT THIS GRAPH (#1604). After a `|` it filters another command's
        # output (`npm test | grep -E 'FAIL|ok'` named `Result.fail` and a test helper `fail`); over files no graph
        # indexes (a log, a shell script, YAML) it names whatever shares a word with the pattern.
        seps = re.findall(r'\|\||&&|;|\n|\|', c[:m.start()])
        if seps and seps[-1] == '|': sys.exit(0)
        files = [a for a in rest if not a.startswith('-')]
        if files and all(os.path.splitext(a)[1] and os.path.splitext(a)[1].lower() not in _graphline.LANG for a in files): sys.exit(0)
    if m: tool = 'Grep'; inp = {'pattern': m.group(3)}; _from_shell = True
    else:
        m = re.search(r"sed -n '?(\d+),(\d+)p'? (\S+)", c) or re.search(r'\bcat\s+(\S+\.(?:' + _where.SOURCE_ALT + r'))\b', c)
        # a relative file is relative to where the shell is when it runs: the session's directory, or a `cd` before it
        if m: base, _ = _where.bash_where(c[:m.start()], scwd)
        if m and m.re.groups == 3: tool = 'Read'; inp = {'file_path': _where._abs(m.group(3), base), 'offset': int(m.group(1)), 'limit': int(m.group(2)) - int(m.group(1)) + 1}
        elif m: tool = 'Read'; inp = {'file_path': _where._abs(m.group(1), base)}
        else: sys.exit(0)
        if _where.root_of(inp['file_path']) != cwd: sys.exit(0)  # the file read is another tree's, or none's

# names are looked up by prefix on every grep: an index on symbols.name keeps that under 0.1 s (created once, harmless if present)
try: con.execute("CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name)"); con.commit()
except Exception: pass

# how many tests reach this method, answered ON DEMAND from graph.sqlite rather than from a precomputed table.
# The table was built by summary.dl, an all-sources closure over every test and entry point: on a 1.23M-LOC Java
# bundle that is up to 15,789 tests x 25,154 methods, and it never finished — 594 s of CPU and then its own 600 s
# timeout, with or without a compiled binary, so the counts never existed on a graph large enough to want them.
# Seeded from one method the same closure is small, and the cap keeps a hub method flat. Each edge table joins in
# its OWN recursive branch so SQLite drives them by index; one combined edge CTE rescans every edge per call.
REACH_DEPTH = 6
def reach_counts(mid):
    try:
        tot = q("SELECT count(*) n FROM symbols WHERE is_test = 1 AND method_id IS NOT NULL")[0]['n']
        if not tot: return ''
        rows = q("""WITH RECURSIVE r(id,d) AS (
                      SELECT ?, 0
                      UNION SELECT ce.caller_id, r.d+1 FROM call_edges ce JOIN r ON ce.callee_method_id=r.id WHERE r.d<?
                      UNION SELECT dc.base_method_id, r.d+1 FROM dispatch_candidates dc JOIN r ON dc.candidate_method_id=r.id WHERE r.d<?)
                    SELECT count(DISTINCT CASE WHEN s.is_test=1 THEN r.id END) t
                    FROM r LEFT JOIN symbols s ON s.id=r.id""", (mid, REACH_DEPTH, REACH_DEPTH))
        n = rows[0]['t'] if rows else 0
        # a number that is the same for almost everything says nothing — omit it
        return f"  tests {n}" if n and n < 0.25 * tot else ''
    except Exception: return ''

def context_ids():
    return [i for r in load_state()['reads'] for i in r['ids']]

lines = []
# what the block below is worth under the session's budget (#1199): the declarations it annotates, so no later read
# annotates them again, and whether any edge it shows leads into a file the agent has not opened yet
block_ids, novel = [], True
if tool in ('Edit', 'Write', 'MultiEdit'):
    # the agent changed a file: WHICH declarations, and HOW (a signature, a field's type, a body) — from `axiomcode changed`, the
    # file against the commit the graph was built from — then the blast radius of each from `axiomcode impact`: what must change
    # with it, who produces or writes it, who reads it, what reaches those, the tests. The moment this is useful is now.
    import concurrent.futures
    fp = _where._abs(inp.get('file_path', ''), scwd); rel = rel_of(fp)
    if not _where.is_source(fp) or _where.is_test(rel): sys.exit(0)
    SCR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts')
    try: ch = json.loads(subprocess.run([sys.executable, os.path.join(SCR, 'axiomcode-changed'), cwd, rel, '--json'], capture_output=True, text=True, timeout=10).stdout or '{}')
    except Exception: ch = {}
    decls = [d for d in ch.get('changed', []) if d.get('target')]
    # AN EDIT THAT CHANGED NO DECLARATION SAYS NOTHING. It printed "this edit changed 0 declaration(s) -- added: 1 new
    # line(s)", which restates the edit the agent just made; 28 of 30 of these blocks went unused.
    # A DECLARATION IS REPORTED ONCE A SESSION, on this path as on changes.py's: a signature the PreToolUse hook already
    # reported before the edit landed, or a body edited a second time, is not reported again.
    key = lambda d: f"{d['file']}:{d['symbol']}:{d['kind']}:{d.get('detail', '')}"
    st = load_state(); done = set(st.get('reported', []))
    decls = [d for d in decls if key(d) not in done]
    if not decls: sys.exit(0)
    st['reported'] = list(dict.fromkeys(st.get('reported', []) + [key(d) for d in decls])); save_state(st)   # once per session (changes.py reads this)
    # A BODY EDIT BREAKS NO CALLER, so its readers are not a blast radius: 10-42 `reads / uses it` rows nobody could act on.
    # What it is worth is the tests that reach it and the command that runs them, on one line.
    body = [d for d in decls if d['kind'] == 'body']; decls = [d for d in decls if d['kind'] != 'body']
    def impact(d):
        """SQL first, as changes.py does — the second call site, and the last Datalog dependency in the hooks.
        Shelling to axiomcode-impact cost a median 6.94 s on a 1.23M-LOC bundle and blew this timeout=14 on
        19 of 40 sampled methods; it also carries #833, which kills that script at import wherever
        importlib.machinery is not incidentally bound."""
        try:
            j = graph_sql.impact_shaped(cwd, d['target'] or d.get('shown_target'), file=d.get('file'))
            if j is not None: return d, j
        except Exception: pass
        try: return d, json.loads(subprocess.run([sys.executable, os.path.join(SCR, 'axiomcode-impact'), d['target'] or d.get('shown_target'), cwd, '--json', '--depth', '12'] + (['--kind', d['target_kind']] if d.get('target_kind') and d['target_kind'] != 'param' and '(' not in d['target'] else []), capture_output=True, text=True, timeout=14).stdout or '{}')
        except Exception: return d, {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(impact, decls[:3])); bodies = list(ex.map(impact, body[:3]))
    base = (ch.get('built_at') or '')[:10]
    if decls: lines.append(f"graph: this edit changed {len(decls)} declaration(s) in {rel}" + (f" (against the graph's commit {base})" if base else '') + " —")
    for d, j in results:
        head = f"  {d.get('label') or d['kind']} {d['symbol']}" + (f" — {d['detail']}" if d.get('detail') else '')
        if not j: lines.append(head + "  (impact unavailable)"); continue
        con = j.get('contract', []); dr = graph_sql.hook_direct(j); rc = j.get('reached', []); ts = j.get('tests', [])
        # ordered as ax_edges.DIRECT_ORDER and impact's CERT are: an edge the engine asserted outranks a
        # name or a text match, and neither a hand-off nor a truncated fan-out outranks a resolved call.
        rank = {'resolved': 0, 'one of a set': 1, 'registered': 2, 'capped set': 3, 'in scope': 4, 'by name': 5, 'text': 6}
        dr = sorted(dr, key=lambda x: (rank.get(x['certainty'], 9), x['display']))
        prod = [x for x in dr if x['role'] in ('produces', 'writes')]; reads = [x for x in dr if x['role'] in ('reads', 'uses')]
        def names(xs, k=4): return ', '.join(f"[{x['certainty']}] {x['display']} {x['at'].split('/')[-1]}" for x in xs[:k]) + (f" … +{len(xs) - k}" if len(xs) > k else '')
        lines.append(head)
        if con and d['kind'] in ('signature', 'field', 'type', 'removed'): lines.append(f"    must change with it ({len(con)}): " + ', '.join(f"{x['display']} ({x['why']})" for x in con[:4]) + (' …' if len(con) > 4 else ''))
        if prod: lines.append(f"    produces / writes it ({len(prod)}): " + names(prod))
        # THE FAST PATH COUNTS LESS THAN IT SOUNDS LIKE. graph_sql answers from call_edges: resolved callers,
        # and the by-name sites it can see. The rules add the [in scope], [text] and reference layers, which on
        # a field or a wide method is most of the answer — measured on the JVM parser, 1 against 93 for a field and 5
        # against 137 for a tokeniser method. A COUNT is a claim about completeness, so the fast path does not
        # make one: it names what it has and says where the rest is.
        if reads:
            lines.append(f"    reads / uses it ({len(reads)}): " + names(reads) if not j.get('_sql')
                         else f"    reads / uses it — resolved callers: " + names(reads)
                              + f" (the fast path; `axiomcode impact {d['target'] or d.get('shown_target')}` adds the by-name, in-scope and text layers)")
        # `reached` is a LIST OF PLACEHOLDERS from the SQL shim (graph_sql.impact_shaped fills it with None,
        # deliberately, because both hooks only take len() of it — resolving a location for rows nobody prints cost
        # 5.7 s against 1.7 s on a wide target). Iterating it and calling .get() therefore raised AttributeError and
        # killed this hook, so the PostToolUse block — the blast radius of an edit that just landed, the plugin's
        # most-used output — was never emitted on any graph the shim answers for, silently, because a hook's stderr
        # goes nowhere. The line was dead code: `ent` was never read.
        # WHICH SIDE ANSWERED, in one word. The two paths give different answers by design — the fast path reads
        # call_edges and the rules add the by-name, in-scope and text layers — so a count nobody can attribute is a
        # count nobody can check. This cost a whole re-derivation once: three declarations reported 0 reached and
        # 0 tests where the rules report ~1800 and ~1470, and there was no way to tell from the block whether that
        # was the fast path answering, the rules answering, or the CLI having given up.
        lines.append(f"    [{'fast path' if j.get('_sql') else 'rules'}] reaches {len(rc)} more callable(s) through resolved calls within 12 hops; {len(ts)} test(s) reach the change" + (": " + ', '.join(f"{t['owner'] or (t.get('at') or '').rsplit('/', 1)[-1].split(':')[0] or 'test'}::{t['name']}" for t in ts[:3]) + (' …' if len(ts) > 3 else '') if ts else '') + (f"; {j['unresolved_inside']} unresolved call(s) inside — a lower bound" if j.get('unresolved_inside') else ''))
    if len(decls) > 3: lines.append(f"  … +{len(decls) - 3} more changed declaration(s): axiomcode changed --impact")
    if decls:
        for n in ch.get('notes', [])[:2]: lines.append(f"  added: {n}")
    if bodies:
        lines.append(_graphline.body_line(os.path.join(os.environ.get('AXIOMCODE_GRAPH') or os.path.join(cwd, '.axiomcode'), 'out', 'graph.sqlite'),
                                          bodies + [(d, {}) for d in body[3:]], cwd))
elif tool == 'Read':
    fp = _where._abs(inp.get('file_path', ''), scwd); rel = rel_of(fp)
    a = int(inp.get('offset') or 1); b = a + int(inp.get('limit') or 100000)
    # a member the language synthesises (an enum's values() / valueOf(), a default constructor) is not declared on any line: not listed as one
    rows = q("SELECT s.id, s.method_id, s.display, s.line, s.end_line FROM symbols s JOIN methods m ON m.id = s.method_id WHERE (s.file = ? OR s.file LIKE ?) AND s.method_id IS NOT NULL AND s.kind <> 'module' AND m.kind NOT IN ('ENUM_VALUES', 'ENUM_VALUE_OF', 'DEFAULT_CONSTRUCTOR') AND s.line <= ? AND s.end_line >= ? ORDER BY s.line", rel, '%/' + rel.lstrip('/'), b, a)
    # the graph describes the tree it was indexed from: a file edited since has moved lines and maybe other declarations.
    # That tree is the recorded indexed-tree, uncommitted edits included, and after a background refresh (#1305) it holds
    # edits the commit does not: compared against the commit, a file the graph is current for read as stale.
    stale = ''
    try:
        built = open(os.path.join(cwd, '.axiomcode', 'out', 'stamp')).read().split('-')[0]
        try: against = open(os.path.join(cwd, '.axiomcode', 'out', 'indexed-tree')).read().strip() or built
        except OSError: against = built
        if against != 'nogit' and subprocess.run(['git', 'diff', '--quiet', against, '--', rel], cwd=cwd, capture_output=True).returncode == 1: stale = f" — this file changed since the graph was built at {built[:10]}: lines are the graph's, not the file's"
    except Exception: pass
    if rows:
        st = load_state(); ctx = set(context_ids())
        done = set(st.get('annotated_ids', []))                                    # declarations a block already annotated
        opened = set(st.get('opened', [])) | {rel}
        st['opened'] = sorted(opened)
        st['reads'] = ([{'file': rel, 'ids': [r['id'] for r in rows[:12]], 'names': [r['display'] for r in rows[:12]]}] + st['reads'])[:6]; save_state(st)
        # the model has the text it read; the block carries only what that text cannot show: an edge whose other end is in
        # another file, or in this file but OUTSIDE the range read (a whole-file read shows every intra-file call already);
        # overrides (a same-file inner / enum class overriding is not visible as a call either); unresolved sites.
        # Counts by default, names only where they carry information (1–3 callers, an edge to what was read before);
        # ranked ★ (connected to earlier Reads) first, then few-caller methods, then the rest as one line; 6 lines at most
        lo, hi = rows[0]['line'], rows[-1]['end_line'] or b                          # the lines the text actually covers
        mids = [r['method_id'] for r in rows]; ids = [r['id'] for r in rows]; ph = ','.join('?' * len(rows))
        # the other end is in the text the model just read: the range READ, which runs past the last declaration (a script's
        # top-level code after its last function is text the model has), not the span of the declarations in it
        def visible(f, ln): return f == rel and min(a, lo) <= ln <= max(b - 1, hi)
        # A CALLER IS SHOWN BY THE CALL, NOT BY ITS DECLARATION. Judged by the caller's own line, a file's top level (its
        # `<module>`, declared at L1) was never in a range that did not start at L1, so reading a script's functions got
        # `main L56 ← trend.<module> L1` for every one of them — the calls at the bottom of the very text just read. In the
        # loop's runs that shape was most of the Read blocks nobody acted on. A caller whose call site lies in the range is
        # visible; the caller's line is the fallback where a graph records no site line.
        up = collections.defaultdict(list); anyup = set()                        # anyup: has a caller at all, shown or not
        sites = collections.defaultdict(list)
        for e in q(f"SELECT e.callee_method_id m, cr.id, cr.display d, cr.file f, cr.line ln, cr.kind k, cs.start_line sl FROM call_edges e JOIN symbols cr ON cr.id = e.caller_id LEFT JOIN call_sites cs ON cs.id = e.call_site_id WHERE e.callee_method_id IN ({ph}) ORDER BY cr.is_test, cr.display", *mids):
            sites[(e['m'], e['id'])].append(e)
        for (m, _), es in sites.items():
            anyup.add(m); e = dict(es[0])
            if any(visible(x['f'], x['sl'] or x['ln']) for x in es): continue
            if e['k'] == 'module': e['ln'] = min((x['sl'] for x in es if x['sl']), default=e['ln'])   # a top level is where its call is
            if e['d'] not in {x['d'] for x in up[m]}: up[m].append(e)          # overloads of one caller are one name
        # A CALLER THROUGH AN INTERFACE OR A BASE METHOD IS A CALLER (#1542): impact lists it, and call_edges alone does
        # not hold it where the engine narrowed an interface-typed field to its one bean. Counted from the same reader.
        via = _graphline.callers_via_base(con, mids, cwd)
        if via:
            vids = sorted({c for cs in via.values() for c in cs})
            vrow = {r['id']: r for r in q(f"SELECT id, display d, file f, line ln, kind k FROM symbols WHERE id IN ({','.join('?' * len(vids))})", *vids)}
            for m, cs in via.items():
                anyup.add(m)
                known = {e['id'] for (m_, _), es in sites.items() if m_ == m for e in es}     # already a call_edges caller
                for c in sorted(cs, key=lambda c: (vrow[c]['d'] if c in vrow else c)):
                    if c in vrow and c not in known and not visible(vrow[c]['f'], vrow[c]['ln']) and vrow[c]['d'] not in {x['d'] for x in up[m]}:
                        up[m].append(dict(vrow[c], sl=None))
        dn = collections.defaultdict(list)
        for e in q(f"SELECT DISTINCT e.caller_id c, ce.id, ce.display d, ce.file f, ce.line ln FROM call_edges e JOIN symbols ce ON ce.method_id = e.callee_method_id WHERE e.caller_id IN ({ph}) AND e.callee_provenance = 'client'", *ids):
            if not visible(e['f'], e['ln']) and e['d'] not in {x['d'] for x in dn[e['c']]}: dn[e['c']].append(e)
        ov_in, ov_out = collections.Counter(), collections.Counter()
        if q("SELECT 1 FROM sqlite_master WHERE name='dispatch_candidates'"):
            # same-owner candidates are overloads, not overrides — never reported as dispatch
            for e in q(f"SELECT DISTINCT dc.base_method_id b, s.file f, s.owner o FROM dispatch_candidates dc JOIN symbols s ON s.method_id = dc.candidate_method_id JOIN symbols bs ON bs.method_id = dc.base_method_id WHERE dc.base_method_id IN ({ph}) AND dc.candidate_method_id <> dc.base_method_id AND s.owner <> bs.owner", *mids):
                (ov_in if e['f'] == rel else ov_out)[e['b']] += 1
        unres = collections.Counter()
        if q("SELECT 1 FROM sqlite_master WHERE name='unresolved_sites'"):
            for e in q(f"SELECT caller_id c, count(*) n FROM unresolved_sites WHERE caller_id IN ({ph}) GROUP BY caller_id", *ids): unres[e['c']] = e['n']
        info = []
        for r in rows:
            # a type-level synthetic has no body to call into, so naming it here points the reader at
            # nothing and cannot be checked — its line does not carry its name (ax_contract.SYNTHETIC)
            # `display`, because that is the column this query selects AND the string that gets printed —
            # guarding on a column the row does not carry reads as '' and silently never fires
            if _ax.is_synthetic(r['display']): continue
            u, d = up[r['method_id']], dn[r['id']]
            su, sd = [x for x in u if x['id'] in ctx], [x for x in d if x['id'] in ctx]
            if u or d or ov_in[r['method_id']] or ov_out[r['method_id']] or unres[r['id']]: info.append(dict(r=r, up=u, dn=d, ovi=ov_in[r['method_id']], ovo=ov_out[r['method_id']], un=unres[r['id']], su=su, sd=sd, star=su + sd))
        # A DECLARATION IS ANNOTATED ONCE A SESSION, however its lines are reached again: the same range, an overlapping
        # one, the whole file after a range of it, or the same file through another spelling of its path. A key on the
        # read's own arguments caught only the first of those.
        info = [x for x in info if x['r']['id'] not in done]
        # A BLOCK OF BARE UNRESOLVED COUNTS NAMES NOTHING TO GO TO (`main L44  ?7 unresolved call(s)` and no edge): no caller,
        # callee or override to open, so it is context spent on a number. Kept when one declaration carries anything else.
        if not any(x['up'] or x['dn'] or x['ovi'] or x['ovo'] or task_hits(x['r']['display']) for x in info): info = []
        block_ids = [x['r']['id'] for x in info]
        # an edge into a file the agent has not opened is what a read cannot show it; one into a file it has read is
        # something it may already have seen from the other end
        novel = any(y['f'] not in opened for x in info for y in x['up'] + x['dn']) or any(x['ovo'] for x in info)
        short = lambda d: d.split('.')[-1] if d.count('.') > 1 else d
        def nm(y): return y['d'] + (f" L{y['ln']}" if y['f'] == rel else '')       # a same-file end outside the range: say where
        # a caller count of 0 says WHY where the graph knows (#1507 cluster): `←entry (http)`, `←0 resolved, 2 by name`,
        # `←? framework (@Scheduled)`. A framework-called method printed as `←0` read as dead code
        def ups(x):
            if x['up']: return str(len(x['up']))
            # every caller is in the lines just read: `←0` there read as "nothing calls it" while a Grep of the same name
            # said `← 1`; the count is of callers the text does not show, and here there are none to add
            if x['r']['method_id'] in anyup: return ' callers in range'
            if 'zl' not in x: x['zl'] = _graphline.zero_label(con, x['r']['method_id'])
            return x['zl']
        def line(x):
            r = x['r']; parts = []
            if x['su']: parts.append("← " + ', '.join(f"{nm(y)} ★" for y in x['su'][:2]) + (f", +{len(x['up']) - min(2, len(x['su']))}" if len(x['up']) > min(2, len(x['su'])) else ''))
            elif 1 <= len(x['up']) <= 3: parts.append("← " + ', '.join(nm(y) for y in x['up']))
            elif x['up']: parts.append(f"←{len(x['up'])}")
            elif x['r']['method_id'] not in anyup and ups(x) != '0': parts.append(f"←{ups(x)}")
            if x['ovi'] or x['ovo']: parts.append("→ dispatch: " + ', '.join(filter(None, [f"{x['ovi']} override(s) in this file" if x['ovi'] else '', f"{x['ovo']} elsewhere" if x['ovo'] else ''])))
            if x['sd']: parts.append(f"→ {', '.join(f'{nm(y)} ★' for y in x['sd'][:2])}" + (f", +{len(x['dn']) - min(2, len(x['sd']))}" if len(x['dn']) > min(2, len(x['sd'])) else ''))
            elif x['dn']: parts.append(f"→{len(x['dn'])}" + (" " + ', '.join(nm(y) for y in x['dn'][:2]) if len(x['dn']) <= 2 else ''))
            if x['un']: parts.append(f"?{x['un']} unresolved call(s)")
            if x.get('hits'): parts.append("— your task says " + ', '.join(repr(h) for h in x['hits']))
            return f"  {short(r['display'])} L{r['line']}  " + '   '.join(parts)
        # ★ lines ranked by how many DISTINCT earlier-read methods reach them; one hub caller cannot claim every slot
        for x in info: x['hits'] = task_hits(x['r']['display'])
        # a declaration whose NAME carries the task's words is shown first, ahead of the better-connected ones
        stars = sorted([x for x in info if x['star'] or x['hits']],
                       key=lambda x: (-len(x['hits']), -len({y['id'] for y in x['star']})))
        seen = collections.Counter(); picked = []
        for x in stars:
            k = tuple(sorted({y['id'] for y in x['star']}))
            if seen[k] < 2: picked.append(x); seen[k] += 1
        few = [x for x in info if x not in picked and (1 <= len(x['up']) <= 3 or x['ovi'] or x['ovo'])]
        if not info: rows = []            # everything here was said before, or nothing here has an edge: no header over no lines
        if rows: lines.append(f"graph: {os.path.basename(rel)}:{lo}-{hi} — {len(rows)} callable(s); edges the text does not show (cross-file, outside the range, overrides, unresolved)" + (" ★ = what you read before" if picked else '') + ":" + stale)
        shown = (picked + few)[:5] if rows else []
        for x in shown: lines.append(line(x))
        left = [x for x in info if x not in shown] if rows else []
        # an anonymous function (`<arrow>`, `<lambda>`) has no name to grep or ask about: counted in `+N more`, not listed
        anon = lambda x: re.fullmatch(r'<[\w-]+>', x['r']['display'].rsplit('.', 1)[-1]) is not None   # `Walker.<arrow>` too
        n_left = len(left); left = [x for x in left if not anon(x)]
        if left: lines.append("  " + ('+%d more: ' % n_left) + ', '.join(f"{short(x['r']['display'])} ←{ups(x)}" + (f" →{len(x['dn'])}" if x['dn'] and not x['up'] else '') + (f" ?{x['un']}" if x['un'] else '') for x in sorted(left, key=lambda x: (-len(x.get('hits') or ()), -(len(x['up']) + x['un'])))[:6]) + (' …' if len(left) > 6 else '') + "   (grep Type.name or axiomcode path to narrow)")
elif tool == 'Grep' and not (inp.get('path') and os.path.relpath(os.path.realpath(_where._abs(inp['path'], scwd)), os.path.realpath(cwd)).split(os.sep)[0] == '..'):
    # (a Grep of a path outside this tree is about another codebase — nothing here to add)
    # a real search is rarely one identifier: `hasNext\(\)|\.next\(\)|close\(\)`, `getScanner|RTBoundValidator|withSSTablesIterated`.
    # Split the alternation, strip the regex around each branch, keep the identifiers, look each one up — in parallel, one
    # connection per thread — and cap the whole block so a 6-way grep still reads as a glance
    import concurrent.futures
    pat = str(inp.get('pattern', ''))
    idents = []
    # `a|b` is alternation for rg and grep -E, `a\|b` for plain grep: both are branches (a literal pipe is not an identifier)
    for br in re.split(r'\\\||(?<!\\)\|', pat):
        b = re.sub(r'\\[bBwWsSdD.()\[\]{}+*?^$|]', ' ', br)              # \( \) \. \b … → separators
        b = re.sub(r'[()\[\]{}+*?^$.]', ' ', b)                            # unescaped regex syntax → separators
        for n in re.findall(r'[A-Za-z_]\w{2,}', b):
            if not re.fullmatch(r'(the|and|for|new|return|null|true|false|this|void|int|String|public|private)', n) and n not in idents: idents.append(n)
    idents = idents[:6]
    ctx = context_ids(); ctx_names = {i: nm for r in load_state()['reads'] for i, nm in zip(r['ids'], r['names'])}
    def lookup(n):
        c = sqlite3.connect(db); c.row_factory = sqlite3.Row
        # A plain lowercase word (`once`, `path`, `session`) is as likely prose, a flag or a config key as a name, and by
        # prefix it matches whatever starts with it (`once` -> onceAWeekTrigger). It is looked up exactly, never by prefix,
        # and kept below only when it connects to what the agent read this session — the `close` it was just reading.
        plain = n.islower() and '_' not in n
        # A CONSTANT-SHAPED WORD IS NOT A CALLABLE'S NAME (`FAIL`, `DONE`, `PARSER`, `CACHE`), and the prefix match that
        # used to follow was LIKE, which is case-blind: `FAIL` found `fail`, `PARSER` found `parserPresent`. The prefix is
        # now case-sensitive (GLOB, which the name index also serves), and a grep run through the shell is matched as
        # whole names only: its pattern is as often a word in a log as a name in code (#1604).
        if re.fullmatch(r'[A-Z0-9_]+', n): return n, [], []
        COLS = "id, method_id, display, file, line, is_test"
        rows = c.execute(f"SELECT {COLS} FROM symbols WHERE name = ? AND method_id IS NOT NULL AND kind <> 'module' ORDER BY file LIMIT 40", (n,)).fetchall() \
            or ([] if plain or _from_shell else c.execute(f"SELECT {COLS} FROM symbols WHERE name GLOB ? AND method_id IS NOT NULL AND kind <> 'module' ORDER BY length(name), file LIMIT 12", (n + '*',)).fetchall())
        # A NAME DECLARED SEVERAL TIMES IS A BASE AND ITS OVERRIDES (#1546): the base first, with how many override it, then
        # production before tests, then by path. Ordered by path alone, two test stubs under `adapter-*` took both slots
        # and the base, the main-source override and the count were all left out.
        nover = {}
        if len(rows) > 1:
            has_ovr = c.execute("SELECT 1 FROM overrides LIMIT 1").fetchone() is not None if c.execute("SELECT 1 FROM sqlite_master WHERE name='overrides'").fetchone() else False
            has_dc = c.execute("SELECT 1 FROM sqlite_master WHERE name='dispatch_candidates'").fetchone() is not None
            for r in rows:
                k = c.execute("SELECT count(DISTINCT overriding_method_id) FROM overrides WHERE method_id = ?", (r['method_id'],)).fetchone()[0] if has_ovr else 0
                if not k and not has_ovr and has_dc:        # Python and TypeScript keep the envelope in dispatch_candidates
                    k = c.execute("SELECT count(DISTINCT candidate_method_id) FROM dispatch_candidates WHERE base_method_id = ? AND candidate_method_id <> base_method_id", (r['method_id'],)).fetchone()[0]
                nover[r['id']] = k
            rows = sorted(rows, key=lambda r: (-nover[r['id']], r['is_test'] or 0, r['file']))
        # the declarations connected to what the agent just read: called BY a read callable, or CALLING one — first, and marked
        rel_ = {}
        unres = []
        if ctx:
            ph = ','.join('?' * len(ctx))
            # a call written `n` inside what was read whose receiver the engine could not type: it may be any of these — say so
            unres = c.execute(f"SELECT cs.caller_id, cs.start_line FROM call_sites cs JOIN unresolved_sites u ON u.call_site_id = cs.id WHERE cs.callee_name = ? AND cs.caller_id IN ({ph}) LIMIT 3", (n, *ctx)).fetchall()
        if ctx and (len(rows) > 1 or plain):
            for r in rows:
                e = c.execute(f"SELECT cr.id AS who, 'called from' AS how FROM call_edges e JOIN symbols cr ON cr.id = e.caller_id WHERE e.callee_method_id = ? AND e.caller_id IN ({ph}) LIMIT 1", (r['method_id'], *ctx)).fetchone() \
                    or c.execute(f"SELECT ce.id AS who, 'calls' AS how FROM call_edges e JOIN symbols ce ON ce.method_id = e.callee_method_id WHERE e.caller_id = ? AND ce.id IN ({ph}) LIMIT 1", (r['id'], *ctx)).fetchone()
                if e: rel_[r['id']] = (e['how'], ctx_names.get(e['who'], '?'))
            rows = sorted(rows, key=lambda r: r['id'] not in rel_)                   # stable: the order above within each group
        if plain and not rel_ and not unres: return n, [], []
        # OVERLOADS IN ONE FILE ARE ONE NAME TO THE READER: `ISender.Send` declared twice in one interface printed as the
        # same line twice. Each (display, file) is one line, saying how many declarations it stands for.
        grp = {}
        for r in rows: grp.setdefault((r['display'], r['file']), []).append(r)
        rows = [v[0] for v in grp.values()]; n_ol = {v[0]['id']: len(v) for v in grp.values()}
        total = len(rows); rows = rows[:2]
        out = []
        paths = _graphline.distinct_paths([r['file'] or '' for r in rows])
        for r, path in zip(rows, paths):
            # PRODUCTION CALLERS ARE NAMED BEFORE TESTS (#1507): unordered, SQLite returned them by display, so two test
            # methods took both name slots and the three production callers hid behind the count
            up = c.execute("SELECT DISTINCT cr.display d, cr.is_test t FROM call_edges e JOIN symbols cr ON cr.id = e.caller_id WHERE e.callee_method_id = ? ORDER BY cr.is_test, cr.display LIMIT 40", (r['method_id'],)).fetchall()
            via = ''
            # the callers through an interface or base method, which impact lists as `calls it (via the interface)`
            vb = sorted(_graphline.callers_via_base(c, [r['method_id']], cwd).get(r['method_id'], ()))
            if vb:
                have = {x['d'] for x in up}
                more = [x for x in c.execute(f"SELECT DISTINCT display d, is_test t FROM symbols WHERE id IN ({','.join('?' * len(vb))})", vb).fetchall() if x['d'] not in have]
                if more:
                    up = sorted(list(up) + more, key=lambda x: (x['t'], x['d']))[:40]
                    via = f"; {len(more)} through the interface or base" if len(more) < len(up) else '; through the interface or base'
            nt = sum(1 for x in up if x['t'])
            # by DISPLAY, like the names printed beside it: two overloads of one callee are one name to the reader
            dn = c.execute("SELECT count(*) n FROM (SELECT DISTINCT ce.display FROM call_edges e JOIN symbols ce ON ce.method_id = e.callee_method_id WHERE e.caller_id = ? AND e.callee_provenance = 'client')", (r['id'],)).fetchone()['n']
            un = c.execute("SELECT count(*) n FROM unresolved_sites WHERE caller_id = ?", (r['id'],)).fetchone()['n']
            tag = f"  ★ {rel_[r['id']][0]} {rel_[r['id']][1]} (which you just read)" if r['id'] in rel_ else ''
            # the tests are counted apart only below the 40-row cap: at the cap the split is not known
            callers = (f"{len(up)} (" + ', '.join(x['d'].split('.')[-1] for x in up[:2]) + (', …' if len(up) > 2 else '')
                       + (f"; {nt} in tests" if nt and 2 < len(up) < 40 and nt < len(up) else '') + via + ")") if up \
                      else _graphline.zero_label(c, r['method_id'], None, r['is_test'])
            out.append(f"  {r['display']}  {path}:{r['line']}  ← {callers}  → {dn}" + (f"  ? {un}" if un else '')
                       + (f"  ⇣ {nover[r['id']]} override(s)" if nover.get(r['id']) else '')
                       + (f"  ({n_ol[r['id']]} overloads)" if n_ol.get(r['id'], 1) > 1 else '') + tag)
        if total > len(rows) and out: out[-1] += f"  (+{total - len(rows)} more declaration(s){'' if total < 40 else ' or more'})"
        if unres: out.append(f"  ({ctx_names.get(unres[0]['caller_id'], '?')}, which you just read, calls a `{n}` at L{unres[0]['start_line']} whose receiver is not typed — it may be any of the above)")
        return n, rows, out
    if idents:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, len(idents))) as ex: found = list(ex.map(lookup, idents))
        found = [(n, rows, out) for n, rows, out in found if rows]
        opened = set(load_state().get('opened', []))
        novel = any(r['file'] not in opened for _, rows, _ in found for r in rows)
        if found:
            lines.append(f"graph: {len(found)}/{len(idents)} name(s) are callables (← callers → callees ? unresolved)")
            budget = 6
            for n, rows, out in found:
                if budget <= 0: lines.append("  …"); break
                take = out[:max(1, min(len(out), budget // max(1, len(found) - found.index((n, rows, out)))))]
                lines += take; budget -= len(take)
elif tool == 'Glob':
    # a file search: the files the graph knows under that name, with what each declares (its callables, most-called first)
    toks = [t for t in re.findall(r'[A-Za-z_][\w-]{2,}', str(inp.get('pattern', '')).split('/')[-1]) if t.lower() not in ('java', 'ts', 'tsx', 'js', 'py', 'test', 'src', 'main')]
    frag = max(toks, key=len) if toks else ''
    if len(frag) >= 3:
        rows = q("SELECT file, count(*) n FROM symbols WHERE file LIKE ? AND method_id IS NOT NULL AND kind <> 'module' GROUP BY file ORDER BY n DESC LIMIT 4", f"%{frag}%")
        if rows:
            lines.append(f"graph: {len(rows)} file(s) matching *{frag}* have callables —")
            for r in rows:
                top = q("SELECT s.display, (SELECT count(*) FROM call_edges e WHERE e.callee_method_id = s.method_id) c FROM symbols s WHERE s.file = ? AND s.method_id IS NOT NULL AND s.kind <> 'module' ORDER BY c DESC LIMIT 3", r['file'])
                lines.append(f"  {r['file']}: {r['n']} callable(s); most called: " + ', '.join(f"{t['display']} ({t['c']})" for t in top))
# A PER-SESSION BUDGET FOR WHAT A READ OR A SEARCH GETS (#1199). Each block is small, but a session reads a lot and
# every block stays in the agent's context for the rest of it: in three runs of an implementation task these blocks
# came to 23k-27k characters a run, more than any graph answer in the same runs. The edges of an EDIT (what the change
# just made reaches) are a different signal and stay outside the budget.
# THE MOST USEFUL BLOCKS GET THE BUDGET. A block whose every edge ends in a file the agent has already opened competes
# for the first half only; the second half is kept for blocks that point somewhere it has not been, which is the one
# thing a read cannot show.
ENRICH_BUDGET = int(os.environ.get('AXIOMCODE_ENRICH_BUDGET', '6000'))
if lines and tool in ('Read', 'Grep', 'Glob'):
    st = load_state()
    key = f"{tool}|{inp.get('file_path') or inp.get('pattern')}|{inp.get('offset') or ''}|{inp.get('limit') or ''}"
    seen = st.setdefault('annotated', [])
    spent = st.get('enriched_chars', 0)
    if key in seen:
        lines = []                                            # the same range, or the same search, is annotated once
    elif spent >= ENRICH_BUDGET:
        lines = [] if st.get('budget_said') else [f"graph: this session's enrichment budget ({ENRICH_BUDGET} characters) is spent, so reads and searches get no more of these blocks; ask `axiomcode impact` / `path` directly for a declaration's edges"]
        st['budget_said'] = True
    elif not novel and spent >= ENRICH_BUDGET // 2:
        lines = []                                            # only edges into files already opened: the rest is kept for new ones
    else:
        st['enriched_chars'] = spent + sum(len(l) + 1 for l in lines); seen.append(key)
        st['annotated_ids'] = st.get('annotated_ids', []) + block_ids
    save_state(st)
# every invocation is logged next to the graph — stream-json does not carry additionalContext, so this is how a run proves the
# hook fired and what it added
try:
    with open(os.path.join(cwd, '.axiomcode', 'hooks.jsonl'), 'a') as f: f.write(json.dumps({'tool': ev.get('tool_name'), 'as': tool, 'lines': len(lines), 'chars': sum(len(l) for l in lines), 'input': {k: v for k, v in inp.items() if k in ('file_path', 'offset', 'limit', 'pattern', 'old_string', 'new_string')}, 'text': '\n'.join(lines)}) + '\n')
except OSError: pass
_host.emit('PostToolUse', '\n'.join(lines))
