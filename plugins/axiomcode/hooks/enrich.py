#!/usr/bin/env python3
"""PostToolUse on Read / Grep: the agent used its own action; the graph adds what it knows about what came back, for free.

  Read  <file> [offset, limit]  → the callables declared in the lines read: who calls each (count, nearest names), what each
                                 calls, how many calls in it the engine could not resolve
  Grep  <pattern>               → when the pattern is an identifier: its declarations, with callers and callees

Short on purpose (≤ 10 lines, names not bodies): the transcripts showed pasted context makes runs longer, so this says only
what a graph knows and a file does not — the edges. Nothing when the repo has no graph, or the read is not source."""
import json, os, re, sqlite3, subprocess, sys

ev = json.load(sys.stdin); tool = ev.get('tool_name', ''); inp = ev.get('tool_input', {}) or {}; cwd = ev.get('cwd') or os.getcwd()
def rel_of(fp):
    """the graph stores repo-relative paths; the tool's file_path may reach the tree through a symlink while cwd is resolved (or the
    reverse) — compare real paths, and if the file still is not under the tree, fall back to the graph's own suffix match"""
    fp = str(fp)
    for a, b in ((fp, cwd), (os.path.realpath(fp), os.path.realpath(cwd)), (os.path.realpath(fp), cwd), (fp, os.path.realpath(cwd))):
        r = os.path.relpath(a, b)
        if not r.startswith('..'): return r
    return fp
db = os.path.join(cwd, '.axiomcode', 'out', 'graph.sqlite')
if not os.path.exists(db): sys.exit(0)
con = sqlite3.connect(db); con.row_factory = sqlite3.Row
q = lambda s, *p: con.execute(s, p).fetchall()
if not q("SELECT 1 FROM sqlite_master WHERE name='symbols'"): sys.exit(0)

def edges(mid, sid):
    up = q("SELECT DISTINCT cr.display d FROM call_edges e JOIN symbols cr ON cr.id = e.caller_id WHERE e.callee_method_id = ? LIMIT 40", mid)
    dn = q("SELECT DISTINCT ce.display d FROM call_edges e JOIN symbols ce ON ce.method_id = e.callee_method_id WHERE e.caller_id = ? AND e.callee_provenance = 'client' LIMIT 40", sid)
    un = q("SELECT count(*) n FROM unresolved_sites WHERE caller_id = ?", sid)[0]['n']
    s = f"← {len(up)} caller(s)" + (": " + ', '.join(r['d'] for r in up[:3]) + (' …' if len(up) > 3 else '') if up else '') + f"   → {len(dn)} callee(s)" + (": " + ', '.join(r['d'] for r in dn[:3]) + (' …' if len(dn) > 3 else '') if dn else '')
    return s + (f"   ? {un} unresolved" if un else '')

# a grep / sed / cat run through Bash is the same action — in a session where the Grep tool is deferred, that is what the agent does
if tool == 'Bash':
    c = str(inp.get('command', ''))
    m = re.search(r'\b(?:grep|rg|ag|git\s+grep)\b((?:\s+-[-\w=]+)*)\s+(?:-e\s+)?([\'"]?)(.+?)\2(?:\s|$)', c)
    if m: tool = 'Grep'; inp = {'pattern': m.group(3)}
    else:
        m = re.search(r"sed -n '?(\d+),(\d+)p'? (\S+)", c) or re.search(r'\bcat\s+(\S+\.(?:java|ts|tsx|js|py))', c)
        if m and m.re.groups == 3: tool = 'Read'; inp = {'file_path': os.path.join(cwd, m.group(3)) if not m.group(3).startswith('/') else m.group(3), 'offset': int(m.group(1)), 'limit': int(m.group(2)) - int(m.group(1)) + 1}
        elif m: tool = 'Read'; inp = {'file_path': os.path.join(cwd, m.group(1)) if not m.group(1).startswith('/') else m.group(1)}
        else: sys.exit(0)

# names are looked up by prefix on every grep: an index on symbols.name keeps that under 0.1 s (created once, harmless if present)
try: con.execute("CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name)"); con.commit()
except Exception: pass

# the closure the index computed once (tests / entry points reaching each method): a row when it exists, silence when not;
# the first Read on a graph without it starts the computation in the background, so no hook call waits for Datalog
SUMMARY = os.path.join(cwd, '.axiomcode', 'out', 'summary.sqlite')
def reach_counts(mid):
    if not os.path.exists(SUMMARY):
        lock = SUMMARY + '.building'
        if not os.path.exists(lock):
            open(lock, 'w').close()
            subprocess.Popen([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'summary.py'), cwd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return ''
    try:
        sc = sqlite3.connect(SUMMARY); r = sc.execute("SELECT tests, entries FROM reach WHERE method = ?", (mid,)).fetchone()
        return f"   reached by {r[0]} test(s), {r[1]} entry point(s)" if r else "   reached by no test / entry point"
    except Exception: return ''

lines = []
if tool in ('Edit', 'Write', 'MultiEdit'):
    # the agent changed a method: the callers that must change with it, its overrides, the tests that reach it — the moment
    # this is useful is now, not when the agent thinks to ask. One single-source closure (Datalog, ~0.3–0.6 s), ≤ 8 lines
    fp = str(inp.get('file_path', '')); rel = rel_of(fp)
    if not re.search(r'\.(java|ts|tsx|js|py)$', rel) or '/test' in rel: sys.exit(0)
    frag = str(inp.get('old_string') or inp.get('new_string') or (inp.get('edits') or [{}])[0].get('new_string', ''))
    try: src = open(fp, errors='replace').read()
    except OSError: sys.exit(0)
    at = src.find(frag.strip()[:80]) if frag.strip() else -1
    ln = src.count('\n', 0, at) + 1 if at >= 0 else None
    rows = q("SELECT id, method_id, display, line, end_line FROM symbols WHERE (file = ? OR file LIKE ?) AND method_id IS NOT NULL AND kind <> 'module' AND line <= ? AND end_line >= ? ORDER BY (end_line - line) LIMIT 1", rel, '%/' + rel.lstrip('/'), ln, ln) if ln else []
    if not rows: sys.exit(0)
    m = rows[0]
    up = q("SELECT DISTINCT cr.display d, cs.start_line ln FROM call_edges e JOIN symbols cr ON cr.id = e.caller_id LEFT JOIN call_sites cs ON cs.id = e.call_site_id WHERE e.callee_method_id = ? LIMIT 30", m['method_id'])
    ov = q("SELECT DISTINCT s.display d FROM dispatch_candidates dc JOIN symbols s ON s.method_id = dc.candidate_method_id WHERE dc.base_method_id = ? LIMIT 8", m['method_id']) if q("SELECT 1 FROM sqlite_master WHERE name='dispatch_candidates'") else []
    un = q("SELECT count(*) n FROM unresolved_sites WHERE caller_id = ?", m['id'])[0]['n']
    lines.append(f"graph: you changed {m['display']} ({rel}:{m['line']}-{m['end_line']})")
    lines.append(f"  direct callers ({len(up)}): " + (', '.join(f"{r['d']} L{r['ln']}" for r in up[:6]) + (' …' if len(up) > 6 else '') if up else 'none resolved'))
    if ov: lines.append(f"  overrides / implementations that share its contract ({len(ov)}): " + ', '.join(r['d'] for r in ov[:5]))
    AX = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts', 'axiomcode')
    try:
        o = subprocess.run(['bash', AX, 'path', '*', m['display'], cwd, '--depth', '8', '--limit', '60'], capture_output=True, text=True, timeout=8).stdout
        tests = re.findall(r'^\s+(\d+) hop\(s\)\s+(\S+)\s+\[test\]', o, re.M)
        tot = re.search(r'everything that can reach .*?: (\d+) method\(s\)', o)
        if tests: lines.append(f"  tests that reach it within 8 hops ({len(tests)} shown of {tot.group(1) if tot else '?'} reaching callables): " + ', '.join(f"{t[1]} ({t[0]} hops)" for t in tests[:4]))
        elif tot: lines.append(f"  {tot.group(1)} callable(s) reach it within 8 hops; no test among the nearest 60")
    except subprocess.TimeoutExpired: lines.append("  (reach closure timed out)")
    if un: lines.append(f"  {un} call(s) inside it the graph could not resolve — callers through those are not listed")
elif tool == 'Read':
    fp = str(inp.get('file_path', '')); rel = rel_of(fp)
    a = int(inp.get('offset') or 1); b = a + int(inp.get('limit') or 100000)
    rows = q("SELECT id, method_id, display, line, end_line FROM symbols WHERE (file = ? OR file LIKE ?) AND method_id IS NOT NULL AND kind <> 'module' AND line <= ? AND end_line >= ? ORDER BY line", rel, '%/' + rel.lstrip('/'), b, a)
    if rows:
        lines.append(f"graph: {len(rows)} callable(s) in {rel}:{a}-{min(b, rows[-1]['end_line'] or b)} —")
        for r in rows[:8]: lines.append(f"  {r['display']} L{r['line']}  {edges(r['method_id'], r['id'])}{reach_counts(r['method_id'])}")
        if len(rows) > 8: lines.append(f"  … +{len(rows) - 8}; axiomcode path / impact for any of them")
elif tool == 'Grep':
    pat = str(inp.get('pattern', ''))
    names = [n for n in re.findall(r'[A-Za-z_]\w{2,}', pat) if not re.fullmatch(r'(the|and|for|new|return|null|true|false)', n)]
    if len(names) == 1 and re.fullmatch(r'[\w.\\|()]*', pat.replace('\\b', '')):
        n = names[0]
        # a grep pattern is a prefix as often as a name (`insertEmpty` for insertEmptyElementFor): exact first, then names starting with it
        rows = q("SELECT id, method_id, display, file, line FROM symbols WHERE name = ? AND method_id IS NOT NULL AND kind <> 'module' ORDER BY file LIMIT 6", n) \
            or q("SELECT id, method_id, display, file, line FROM symbols WHERE name LIKE ? AND method_id IS NOT NULL AND kind <> 'module' ORDER BY length(name), file LIMIT 6", n + '%')
        if rows:
            lines.append(f"graph: `{n}` " + ("is declared" if rows[0]['display'].endswith('.' + n) or rows[0]['display'] == n else "matches") + f" {len(rows)} callable(s) —")
            for r in rows[:5]: lines.append(f"  {r['display']}  {r['file']}:{r['line']}  {edges(r['method_id'], r['id'])}")
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
if lines: print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PostToolUse', 'additionalContext': '\n'.join(lines)}}))
