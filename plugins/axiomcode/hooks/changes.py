#!/usr/bin/env python3
"""Change impact at every moment an edit happens, not only through the Edit tool.

  PreToolUse   Edit / Write / MultiEdit   the edit is applied to a copy of the file; when it changes a SIGNATURE, a FIELD's
                                          type, a TYPE header, or removes a declaration, the blast radius is given BEFORE the
                                          file changes (a body-only edit is reported after, by enrich.py — nothing breaks)
  PostToolUse  Bash                       a command that can modify sources (sed -i, patch, git apply / checkout / pull / merge /
                                          stash pop / cherry-pick / revert, a redirect into a source file, a script run): the
                                          whole working tree against the graph's commit, the declarations not reported yet
  UserPromptSubmit                        the safety net: whatever changed the tree since the graph's commit — by any means —
                                          and has not been reported in this session, on the next prompt

Every declaration is reported once per session (state next to the graph). Each line comes from `axiomcode changed` (which
declaration, how) and `axiomcode impact` (what must change with it, who produces / writes it, who reads it, what reaches
those, the tests) — ≤ 3 declarations per event, in parallel, a few lines each."""
import concurrent.futures, json, os, re, subprocess, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts'))
import graph_sql
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _host

ev = _host.read(); event = ev.get('hook_event_name', ''); tool = ev.get('tool_name', ''); inp = ev.get('tool_input', {}) or {}; cwd = ev.get('cwd') or os.getcwd()
if not os.path.exists(os.path.join(cwd, '.axiomcode', 'out', 'graph.sqlite')): sys.exit(0)
SCR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts')
SRC = re.compile(r'\.(java|ts|tsx|js|mjs|cjs|py)$'); TEST = re.compile(r'(^|/)(tests?|__tests__)/|/src/test/|Tests?\.java$|\.(spec|test)\.[jt]sx?$|(^|/)test_')
STATE = os.path.join(cwd, '.axiomcode', f"hooks-state-{ev.get('session_id', 'x')}.json")
def load_state():
    try: return json.load(open(STATE))
    except Exception: return {}
def save_state(st):
    try: json.dump(st, open(STATE, 'w'))
    except OSError: pass
def rel_of(fp):
    fp = str(fp)
    for a, b in ((fp, cwd), (os.path.realpath(fp), os.path.realpath(cwd)), (os.path.realpath(fp), cwd), (fp, os.path.realpath(cwd))):
        r = os.path.relpath(a, b)
        if not r.startswith('..'): return r
    return fp

def changed(args, timeout=12):
    try: return json.loads(subprocess.run([sys.executable, os.path.join(SCR, 'axiomcode-changed'), cwd, *args, '--json'], capture_output=True, text=True, timeout=timeout).stdout or '{}')
    except Exception: return {}

def summarize(decls, head, contract_kinds=('signature', 'field', 'type', 'removed')):
    """the blast radius of up to three changed declarations, a few lines each"""
    def impact(d):
        """SQL first. The Datalog run this replaced was a median 6.94 s on a 1.2M-LOC bundle, p90 23.8 s, and 17 of 38
        randomly sampled methods blew the 14 s timeout below — so on roughly half of real edits the hook printed
        "(impact unavailable)" after waiting the full timeout. fastimpact answers the same lines in a flat ~1.7 s and
        matched impact.dl exactly on 14/14 sampled targets (contract, resolved and by-name tiers as SETS).
        It returns None for what it does not cover (a constructor, whose callers are instantiations rather than call
        edges); that falls through to impact.dl, which is still right for those."""
        try:
            j = graph_sql.impact_shaped(cwd, d['target'])
            if j is not None: return d, j
        except Exception: pass
        try: return d, json.loads(subprocess.run([sys.executable, os.path.join(SCR, 'axiomcode-impact'), d['target'], cwd, '--json', '--depth', '12'] + (['--kind', d['target_kind']] if d.get('target_kind') and d['target_kind'] != 'param' and '(' not in d['target'] else []), capture_output=True, text=True, timeout=14).stdout or '{}')
        except Exception: return d, {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex: results = list(ex.map(impact, decls[:3]))
    lines = [head]
    # ordered as ax_edges.DIRECT_ORDER and impact's CERT are: an edge the engine asserted outranks a
    # name or a text match, and neither a hand-off nor a truncated fan-out outranks a resolved call.
    rank = {'resolved': 0, 'one of a set': 1, 'registered': 2, 'capped set': 3, 'in scope': 4, 'by name': 5, 'text': 6}
    for d, j in results:
        hd = f"  {d['kind']} {d['symbol']}" + (f" — {d['detail']}" if d.get('detail') else '')
        if not j: lines.append(hd + "  (impact unavailable)"); continue
        con = j.get('contract', []); dr = sorted(j.get('direct', []), key=lambda x: (rank.get(x['certainty'], 9), x['display'])); rc = j.get('reached', []); ts = j.get('tests', [])
        prod = [x for x in dr if x['role'] in ('produces', 'writes')]; reads = [x for x in dr if x['role'] in ('reads', 'uses')]
        # THE TIER TRAVELS WITH THE ROW OR IT IS NOT READ. The printed command labels every row [resolved] /
        # [by name] / [text]; this line dropped the label, so four rows of dataflow -- two of them reflective
        # deserialization -- arrived looking exactly like resolved call sites, and were reported as compile
        # errors. The label costs a dozen characters and is the difference between a fact and a guess.
        names = lambda xs, k=4: ', '.join(f"[{x['certainty']}] {x['display']} {x['at'].split('/')[-1]}" for x in xs[:k]) + (f" … +{len(xs) - k}" if len(xs) > k else '')
        lines.append(hd)
        if con and d['kind'] in contract_kinds: lines.append(f"    must change with it ({len(con)}): " + ', '.join(f"{x['display']} ({x['why']})" for x in con[:4]) + (' …' if len(con) > 4 else ''))
        if prod: lines.append(f"    produces / writes it ({len(prod)}): " + names(prod))
        # A RETYPE AND A RENAME DO NOT BREAK THE SAME THINGS, AND NEITHER IS THE LIST ABOVE.
        # `produces / writes it` is dataflow: who makes a value of this shape, including a deserializer that
        # writes it reflectively and never fails a build. What stops a build when a field's TYPE changes is the
        # callers of whatever is generated from it -- the all-args constructor, the setter -- at the argument
        # they pass; those touch the generated member, not the field, so they are in no list here. Left unsaid,
        # a reader takes the first list as "what breaks" and gets the one set of rows that cannot.
        if prod and d['kind'] == 'field' and str(d.get('detail', '')).startswith('type '):
            owner = d['symbol'].rsplit('.', 1)[0] if '.' in d['symbol'] else d['symbol']
            lines.append("    ^ TYPE change: those rows are dataflow, not compile errors — a deserializer writes the"
                         " value without any build failing.")
            lines.append(f"      What breaks the build is the callers of {owner}'s generated constructor / setter, at the"
                         f" argument they pass. They are in no list here: `axiomcode impact '{owner}'` names them.")
        # `bound from outside the source` never fails a build either, and it is the layer most likely to be
        # mistaken for one because it is the longest: say what it is where it is counted.

        # THE FAST PATH COUNTS LESS THAN IT SOUNDS LIKE. graph_sql answers from call_edges: resolved callers,
        # and the by-name sites it can see. The rules add the [in scope], [text] and reference layers, which on
        # a field or a wide method is most of the answer — measured on the JVM parser, 1 against 93 for a field and 5
        # against 137 for a tokeniser method. A COUNT is a claim about completeness, so the fast path does not
        # make one: it names what it has and says where the rest is.
        if reads:
            lines.append(f"    reads / uses it ({len(reads)}): " + names(reads) if not j.get('_sql')
                         else f"    reads / uses it — resolved callers: " + names(reads)
                              + f" (the fast path; `axiomcode impact {d['target']}` adds the by-name, in-scope and text layers)")
        # WHICH SIDE ANSWERED, in one word. The two paths give different answers by design — the fast path reads
        # call_edges and the rules add the by-name, in-scope and text layers — so a count nobody can attribute is a
        # count nobody can check. This cost a whole re-derivation once: three declarations reported 0 reached and
        # 0 tests where the rules report ~1800 and ~1470, and there was no way to tell from the block whether that
        # was the fast path answering, the rules answering, or the CLI having given up.
        lines.append(f"    [{'fast path' if j.get('_sql') else 'rules'}] reaches {len(rc)} more callable(s) through resolved calls within 12 hops; {len(ts)} test(s) reach the change" + (": " + ', '.join(f"{t['owner'] or (t.get('at') or '').rsplit('/', 1)[-1].split(':')[0] or 'test'}::{t['name']}" for t in ts[:3]) + (' …' if len(ts) > 3 else '') if ts else '') + (f"; {j['unresolved_inside']} unresolved call(s) inside — a lower bound" if j.get('unresolved_inside') else ''))
    if len(decls) > 3: lines.append(f"  … +{len(decls) - 3} more: axiomcode changed --impact")
    return lines

def key(d): return f"{d['file']}:{d['symbol']}:{d['kind']}:{d.get('detail', '')}"

lines = []
if event == 'PreToolUse' and tool in ('Edit', 'Write', 'MultiEdit'):
    fp = str(inp.get('file_path', '')); rel = rel_of(fp)
    if not SRC.search(rel) or TEST.search(rel) or not os.path.exists(fp): sys.exit(0)
    cur = open(fp, errors='replace').read(); new = cur
    if tool == 'Write': new = str(inp.get('content', ''))
    else:
        for e in (inp.get('edits') or [inp]):
            o, n = str(e.get('old_string', '')), str(e.get('new_string', ''))
            if o: new = new.replace(o, n) if e.get('replace_all') else new.replace(o, n, 1)
    if new == cur: sys.exit(0)
    with tempfile.NamedTemporaryFile('w', suffix=os.path.splitext(rel)[1], delete=False) as f: f.write(new); tmp = f.name
    j = changed(['--old', fp, '--new', tmp, '--file', rel]); os.unlink(tmp)
    risky = [d for d in j.get('changed', []) if d.get('target') and d['kind'] in ('signature', 'field', 'type', 'removed')]
    if risky:
        lines = summarize(risky, f"graph: this edit is about to change {len(risky)} declaration(s) in {rel} in a way that reaches callers — before it lands:")
        st = load_state(); st['reported'] = list(dict.fromkeys(st.get('reported', []) + [key(d) for d in risky])); save_state(st)
elif event == 'PostToolUse' and tool == 'Bash':
    c = str(inp.get('command', ''))
    if not re.search(r'\bsed\s+-i|\bpatch\b|\bgit\s+(apply|checkout|switch|pull|merge|rebase|revert|cherry-pick|stash\s+pop|reset\s+--hard|restore)\b|>>?\s*\S+\.(java|ts|tsx|js|py)\b|\b(python3?|node|bash|sh)\s+\S+|\bmv\b|\bcp\b|\brm\b', c): sys.exit(0)
    j = changed([], timeout=18)
    st = load_state(); seen = set(st.get('reported', []))
    new = [d for d in j.get('changed', []) if d.get('target') and key(d) not in seen and not TEST.search(d['file'])]
    if new:
        lines = summarize(new, f"graph: after that command, {len(new)} declaration(s) changed in the working tree (against the graph's commit {(j.get('built_at') or '')[:10]}) —")
        st['reported'] = list(seen | {key(d) for d in new}); save_state(st)
elif event == 'UserPromptSubmit':
    j = changed([], timeout=18)
    st = load_state(); seen = set(st.get('reported', []))
    new = [d for d in j.get('changed', []) if d.get('target') and key(d) not in seen and not TEST.search(d['file'])]
    if new:
        lines = summarize(new, f"graph: {len(new)} declaration(s) changed in the working tree since the graph's commit {(j.get('built_at') or '')[:10]} and were not reported yet —")
        st['reported'] = list(seen | {key(d) for d in new}); save_state(st)
try:
    with open(os.path.join(cwd, '.axiomcode', 'hooks.jsonl'), 'a') as f: f.write(json.dumps({'event': event, 'tool': tool, 'lines': len(lines), 'chars': sum(len(l) for l in lines), 'input': {k: v for k, v in inp.items() if k in ('file_path', 'command', 'old_string', 'new_string')}, 'text': '\n'.join(lines)}) + '\n')
except OSError: pass
_host.emit(event, '\n'.join(lines))
