#!/usr/bin/env python3
"""PostToolUse on Read / Grep: the agent used its own action; the graph adds what it knows about what came back, for free.

  Read  <file> [offset, limit]  → the callables declared in the lines read: who calls each (count, nearest names), what each
                                 calls, how many calls in it the engine could not resolve
  Grep  <pattern>               → when the pattern is an identifier: its declarations, with callers and callees

Short on purpose (≤ 10 lines, names not bodies): the transcripts showed pasted context makes runs longer, so this says only
what a graph knows and a file does not — the edges. Nothing when the repo has no graph, or the read is not source."""
import json, os, re, sqlite3, sys

ev = json.load(sys.stdin); tool = ev.get('tool_name', ''); inp = ev.get('tool_input', {}) or {}; cwd = ev.get('cwd') or os.getcwd()
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

lines = []
if tool == 'Read':
    fp = str(inp.get('file_path', '')); rel = os.path.relpath(fp, cwd) if fp.startswith(cwd) else fp
    a = int(inp.get('offset') or 1); b = a + int(inp.get('limit') or 100000)
    rows = q("SELECT id, method_id, display, line, end_line FROM symbols WHERE file = ? AND method_id IS NOT NULL AND kind <> 'module' AND line <= ? AND end_line >= ? ORDER BY line", rel, b, a)
    if rows:
        lines.append(f"graph: {len(rows)} callable(s) in {rel}:{a}-{min(b, rows[-1]['end_line'] or b)} —")
        for r in rows[:8]: lines.append(f"  {r['display']} L{r['line']}  {edges(r['method_id'], r['id'])}")
        if len(rows) > 8: lines.append(f"  … +{len(rows) - 8}; axiomcode path / impact for any of them")
elif tool == 'Grep':
    pat = str(inp.get('pattern', ''))
    names = [n for n in re.findall(r'[A-Za-z_]\w{2,}', pat) if not re.fullmatch(r'(the|and|for|new|return|null|true|false)', n)]
    if len(names) == 1 and re.fullmatch(r'[\w.\\|()]*', pat.replace('\\b', '')):
        n = names[0]
        rows = q("SELECT id, method_id, display, file, line FROM symbols WHERE name = ? AND method_id IS NOT NULL AND kind <> 'module' ORDER BY file LIMIT 6", n)
        if rows:
            lines.append(f"graph: `{n}` is declared {len(rows)} time(s) —")
            for r in rows[:5]: lines.append(f"  {r['display']}  {r['file']}:{r['line']}  {edges(r['method_id'], r['id'])}")
if lines: print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PostToolUse', 'additionalContext': '\n'.join(lines)}}))
