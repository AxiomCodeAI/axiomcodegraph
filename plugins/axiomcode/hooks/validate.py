#!/usr/bin/env python3
"""validate.py <repo> [--reads N] [--greps N] [--edits N] [--replay]  — is what the hooks put in context TRUE?

Every fact a hook block states is checked again, against graph.sqlite and the source:
  Read   each callable named is a symbol in that file at that line, its declaration line holds its name in the file (or the
         block says the file changed since the graph was built); each caller / callee named has an edge whose other end is
         outside the text read (another file, or this file outside the range), `+k` / `←k` / `→k` are the counts of such
         edges, `dispatch: n override(s)` counts different-owner candidates here / elsewhere, `?u` is unresolved_sites',
         `+N more` is the remainder and each entry in it matches a callable of the file with those counts
  Grep   each declaration named has that identifier as its name and is at the file:line printed; callers as above
  Edit   (PreToolUse / PostToolUse / Bash / UserPromptSubmit blocks) each declaration named spans a line the edit changed (from
         `axiomcode changed` on the same texts); every name under must-change / produces / reads is in `axiomcode impact`'s
         answer for that target with that role; the counts match
Events are generated on the repo (Reads of whole files and ranges, Greps of declared identifiers, edits that change a body,
a signature, a field's type) or replayed from .axiomcode/hooks.jsonl (--replay: entries that recorded their input and text).
Prints facts checked / facts wrong, and every wrong fact."""
import atexit, json, os, random, re, sqlite3, subprocess, sys, tempfile, shutil, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                'skills', 'axiomcode', 'scripts'))
from ax_contract import subtokens, is_synthetic        # the annotation's own tokeniser, so this checks its claim

HERE = os.path.dirname(os.path.abspath(__file__))
def hook(script, event, tool, inp, cwd, session='validate', extra=None):
    ev = {'hook_event_name': event, 'tool_name': tool, 'tool_input': inp, 'cwd': cwd, 'session_id': session}
    if extra: ev.update(extra)
    r = subprocess.run([sys.executable, os.path.join(HERE, script)], input=json.dumps(ev), capture_output=True, text=True, timeout=60)
    # a UserPromptSubmit hook writes its context to STDOUT as plain text; the tool hooks wrap theirs in JSON. Falling
    # back to the raw text rather than to '' is what lets the orientation block be checked at all — read as JSON it
    # is simply empty, and an empty block passes every assertion by saying nothing.
    try: return json.loads(r.stdout)['hookSpecificOutput']['additionalContext']
    except Exception: return (r.stdout or '').strip()

class V:
    def __init__(self, repo):
        self.repo = os.path.realpath(repo); self.con = sqlite3.connect(os.path.join(self.repo, '.axiomcode', 'out', 'graph.sqlite')); self.con.row_factory = sqlite3.Row
        self.checked = 0; self.wrong = []
    def q(self, s, *p): return self.con.execute(s, p).fetchall()
    def fact(self, ok, what):
        self.checked += 1
        if not ok: self.wrong.append(what)
    def sym_by_display(self, d, file=None):
        rows = self.q("SELECT * FROM symbols WHERE display = ? AND method_id IS NOT NULL" + (" AND (file = ? OR file LIKE ?)" if file else ''), *([d, file, '%/' + file] if file else [d]))
        return rows
    def callers(self, mid): return {r[0] for r in self.q("SELECT DISTINCT cr.display FROM call_edges e JOIN symbols cr ON cr.id = e.caller_id WHERE e.callee_method_id = ?", mid)}
    def callees(self, sid): return {r[0] for r in self.q("SELECT DISTINCT ce.display FROM call_edges e JOIN symbols ce ON ce.method_id = e.callee_method_id WHERE e.caller_id = ? AND e.callee_provenance = 'client'", sid)}
    def unresolved(self, sid): return self.q("SELECT count(*) FROM unresolved_sites WHERE caller_id = ?", sid)[0][0]
    def line_holds(self, file, line, name):
        try: L = open(os.path.join(self.repo, file), errors='replace').read().split('\n'); return any(re.search(rf'\b{re.escape(name.split(".")[-1].replace("<anon ", "").strip("<>"))}\b', L[i]) for i in range(max(0, line - 1), min(len(L), line + 3)))
        except OSError: return False

    # ── Read ──────────────────────────────────────────────────────────────────────────────────────────────────
    def check_read(self, text, rel, a, b):
        m = re.match(r'graph: (\S+?):(\d+)-(\d+) — (\d+) callable\(s\); edges the text does not show \(cross-file, outside the range, overrides, unresolved\)( ★ = what you read before)?:(.*)$', text.split('\n')[0])
        if not m: self.fact(text == '', f"Read {rel}: unparseable block: {text[:80]}"); return
        stale = 'changed since the graph' in m.group(6); lo, hi = int(m.group(2)), int(m.group(3))
        rows = self.q("SELECT s.* FROM symbols s JOIN methods m ON m.id = s.method_id WHERE (s.file = ? OR s.file LIKE ?) AND s.method_id IS NOT NULL AND s.kind <> 'module' AND m.kind NOT IN ('ENUM_VALUES', 'ENUM_VALUE_OF', 'DEFAULT_CONSTRUCTOR') AND s.line <= ? AND s.end_line >= ? ORDER BY s.line", rel, '%/' + rel, b, a)
        self.fact(int(m.group(4)) == len(rows), f"Read {rel}:{a}-{b}: says {m.group(4)} callables, graph has {len(rows)}")
        self.fact(os.path.basename(rel) == m.group(1), f"Read {rel}: block names file {m.group(1)}")
        if rows: self.fact(lo == rows[0]['line'] and hi == (rows[-1]['end_line'] or b), f"Read {rel}: block says lines {lo}-{hi}, callables span {rows[0]['line']}-{rows[-1]['end_line']}")
        def invisible(r): return not ((r['file'] == rel or r['file'].endswith('/' + rel)) and lo <= r['line'] <= hi)
        def up(s):      # callers the text cannot show, one per display (overloads of one caller are one name)
            return {r['display']: r for r in self.q("SELECT DISTINCT cr.* FROM call_edges e JOIN symbols cr ON cr.id = e.caller_id WHERE e.callee_method_id = ?", s['method_id']) if invisible(r)}
        def dn(s):
            return {r['display']: r for r in self.q("SELECT DISTINCT ce.* FROM call_edges e JOIN symbols ce ON ce.method_id = e.callee_method_id WHERE e.caller_id = ? AND e.callee_provenance = 'client'", s['id']) if invisible(r)}
        def ov(s):
            rs = self.q("SELECT DISTINCT c.file, c.owner FROM dispatch_candidates dc JOIN symbols c ON c.method_id = dc.candidate_method_id JOIN symbols b ON b.method_id = dc.base_method_id WHERE dc.base_method_id = ? AND dc.candidate_method_id <> dc.base_method_id AND c.owner <> b.owner", s['method_id']) if self.q("SELECT 1 FROM sqlite_master WHERE name='dispatch_candidates'") else []
            return sum(1 for r in rs if r['file'] == rel or r['file'].endswith('/' + rel)), sum(1 for r in rs if not (r['file'] == rel or r['file'].endswith('/' + rel)))
        def find(disp, ln):
            c = [r for r in rows if (r['display'] == disp or r['display'].endswith('.' + disp)) and r['line'] == ln]
            self.fact(bool(c), f"Read {rel}: {disp} L{ln} is not a callable at that line in the graph"); return c[0] if c else None
        def names(seg):     # "A ★, B L12 ★, +3"  →  ([A, B], 3, starred)
            ns, plus = [], 0
            for t in [x.strip() for x in seg.split(',') if x.strip()]:
                if t.startswith('+'): plus = int(t[1:])
                else: ns.append(re.sub(r'( L\d+)? ★$', '', t).split(' L')[0])
            return ns, plus
        shown = 0
        for l in text.split('\n')[1:]:
            mm = re.match(r'  (\S+) L(\d+)  (.*)$', l)
            if mm and not l.strip().startswith('+'):
                shown += 1; s = find(mm.group(1), int(mm.group(2)))
                if not s: continue
                # A name the PARSER invented — <arrow>, <call-signature>, <module> — is never written in the
                # source, so looking for it there is a check with no evidence available and only one possible
                # outcome. The declaration's presence at that line is already asserted above; this check is
                # about the NAME agreeing with the text, and for an invented name there is no text to agree.
                if not (s['name'] or '').startswith('<'):
                    self.fact(stale or self.line_holds(s['file'], s['line'], s['name']), f"Read {rel}: line {s['line']} of {s['file']} does not hold {s['name']} (no staleness note)")
                U, D = up(s), dn(s); oi, oo = ov(s); rest = mm.group(3)
                for part in [x for x in re.split(r'   ', rest) if x]:
                    if part.startswith('← '):
                        ns, plus = names(part[2:])
                        for nname in ns: self.fact(nname in U, f"Read {rel}: {s['display']} caller {nname} has no edge the text cannot show")
                        self.fact(len(ns) + plus == len(U), f"Read {rel}: {s['display']} says {len(ns)}+{plus} callers, graph has {len(U)}")
                    elif re.match(r'←\d+$', part): self.fact(int(part[1:]) == len(U), f"Read {rel}: {s['display']} says {part} callers, graph has {len(U)}")
                    elif part.startswith('→ dispatch: '):
                        mi = re.search(r'(\d+) override\(s\) in this file', part); mo = re.search(r'(\d+) elsewhere', part)
                        self.fact((int(mi.group(1)) if mi else 0) == oi and (int(mo.group(1)) if mo else 0) == oo, f"Read {rel}: {s['display']} says overrides {part}, graph has {oi} here / {oo} elsewhere")
                    elif re.match(r'→\d+', part):
                        k = int(re.match(r'→(\d+)', part).group(1)); self.fact(k == len(D), f"Read {rel}: {s['display']} says {k} callees, graph has {len(D)}")
                        for nname in names(part[len(str(k)) + 1:])[0]: self.fact(nname in D, f"Read {rel}: {s['display']} callee {nname} has no edge the text cannot show")
                    elif part.startswith('→ '):
                        ns, plus = names(part[2:])
                        for nname in ns: self.fact(nname in D, f"Read {rel}: {s['display']} callee {nname} has no edge the text cannot show")
                        self.fact(len(ns) + plus == len(D), f"Read {rel}: {s['display']} says {len(ns)}+{plus} callees, graph has {len(D)}")
                    elif part.startswith('?'): self.fact(int(part[1:].split()[0]) == self.unresolved(s['id']), f"Read {rel}: {s['display']} says {part}, table has {self.unresolved(s['id'])}")
                    elif part.startswith('— your task says '):
                        # The annotation claims this declaration's NAME carries a word from the session's task,
                        # which is why it was promoted above better-connected ones. That is checkable, and it is
                        # worth checking: a promotion the reader cannot verify is worse than no promotion, and a
                        # term that is not really in the name would move the wrong declaration to the top.
                        for term in re.findall(r"'([^']+)'", part):
                            # sqlite3.Row indexes, it does not .get() — the same slip this validator exists to catch
                            nm = s['name'] if 'name' in s.keys() else ''
                            toks = set(subtokens(s['display'] or '')) | set(subtokens(nm or ''))
                            carried = term in toks or any(t.startswith(term) and len(term) >= 4 for t in toks)
                            self.fact(carried, f"Read {rel}: {s['display']} is promoted for the task word "
                                               f"'{term}', which its name does not carry")
                    else: self.fact(False, f"Read {rel}: {s['display']} has an unparseable part: {part}")
            elif l.strip().startswith('+'):
                mr = re.match(r'  \+(\d+) more: (.*?)\s+\(grep', l); n = int(mr.group(1))
                # a type-level synthetic is not a callable the block may name (ax_contract.SYNTHETIC), so it
                # is not part of the remainder either — counting it here would make the block's own arithmetic
                # wrong for rows it is right to leave out
                withedges = [r for r in rows if not is_synthetic(r['display'])
                             and (up(r) or dn(r) or any(ov(r)) or self.unresolved(r['id']))]
                self.fact(n == len(withedges) - shown, f"Read {rel}: says +{n} more, graph has {len(withedges)} callables with such edges and {shown} were shown")
                for t in [x.strip().rstrip(' …') for x in mr.group(2).split(',') if x.strip() and x.strip() != '…']:
                    tm = re.match(r'(\S+) ←(\d+)(?: →(\d+))?(?: \?(\d+))?$', t)
                    if not tm: self.fact(False, f"Read {rel}: unparseable summary entry {t}"); continue
                    cands = [r for r in withedges if r['display'] == tm.group(1) or r['display'].endswith('.' + tm.group(1))]
                    self.fact(any(len(up(r)) == int(tm.group(2)) and (tm.group(3) is None or len(dn(r)) == int(tm.group(3))) and (tm.group(4) is None or self.unresolved(r['id']) == int(tm.group(4))) for r in cands), f"Read {rel}: summary entry {t} matches no callable in the file")
    def check_line(self, l, rel, a, b, stale, what, ident=None):
        mm = re.match(r'\s+(\S+)(?:\s+(\S+?):(\d+))?\s+L?(\d+)?\s*← (\d+)(?: \((.*?)\))?\s+→ (\d+)(?:\s+\? (\d+))?(?:\s+tests (\d+))?(?:\s+entries (\d+))?', l)
        if not mm: return
        disp = mm.group(1); fb = mm.group(2); ln = int(mm.group(3) or mm.group(4) or 0); k = int(mm.group(5)); cn = mm.group(6) or ''; mc = int(mm.group(7)); un = int(mm.group(8) or 0)
        rows = self.q("SELECT * FROM symbols WHERE (display = ? OR display LIKE ?) AND method_id IS NOT NULL AND line = ?", disp, '%.' + disp, ln)
        if fb: rows = [r for r in rows if os.path.basename(r['file']) == fb]
        elif rel: rows = [r for r in rows if r['file'] == rel or r['file'].endswith('/' + rel)]
        self.fact(bool(rows), f"{what}: {disp} L{ln} is not a callable at that line in the graph")
        if not rows: return
        s = rows[0]
        if rel and a is not None: self.fact(s['line'] <= b and s['end_line'] >= a, f"{what}:{a}-{b}: {disp} L{ln}-{s['end_line']} does not meet the lines read")
        self.fact(stale or self.line_holds(s['file'], ln, s['name']), f"{what}: line {ln} of {s['file']} does not hold {s['name']} (no staleness note)")
        if ident: self.fact(s['name'].startswith(ident) or ident in s['name'], f"{what}: {disp} does not carry the identifier")
        up = self.callers(s['method_id']); dn = self.callees(s['id'])
        self.fact(k == min(len(up), 40), f"{what}: {disp} says {k} callers, graph has {len(up)}")
        for nm in [x.strip() for x in cn.split(',') if x.strip() and x.strip() != '…']: self.fact(any(u.split('.')[-1] == nm for u in up), f"{what}: {disp} caller {nm} has no edge")
        self.fact(mc == min(len(dn), 40), f"{what}: {disp} says {mc} callees, graph has {len(dn)}")
        self.fact(un == self.unresolved(s['id']), f"{what}: {disp} says {un} unresolved, table has {self.unresolved(s['id'])}")
    # ── Grep ──────────────────────────────────────────────────────────────────────────────────────────────────
    def check_grep(self, text, ident):
        for l in text.split('\n')[1:]:
            if re.match(r'\s+\S+\s+\S+?:\d+\s+←', l): self.check_line(l, None, None, None, True, f"Grep {ident}", ident)
    # ── change blocks ─────────────────────────────────────────────────────────────────────────────────────────
    def check_change(self, text, rel, old_text, new_text):
        SCR = os.path.join(os.path.dirname(HERE), 'skills', 'axiomcode', 'scripts')
        with tempfile.NamedTemporaryFile('w', suffix='.x', delete=False) as fo, tempfile.NamedTemporaryFile('w', suffix='.x', delete=False) as fn:
            fo.write(old_text); fn.write(new_text)
        r = subprocess.run([sys.executable, os.path.join(SCR, 'axiomcode-changed'), self.repo, '--old', fo.name, '--new', fn.name, '--file', rel, '--json'], capture_output=True, text=True)
        try: truth = json.loads(r.stdout)
        except Exception: self.fact(False, f"change {rel}: `changed` failed: {(r.stdout + r.stderr).strip()[-160:]}"); return
        os.unlink(fo.name); os.unlink(fn.name)
        tset = {(d['kind'], d['symbol']) for d in truth.get('changed', [])}
        cur = None
        for l in text.split('\n')[1:]:
            mm = re.match(r'  (signature|body|field|type|removed|added) (\S+)(?: — (.*))?$', l)
            if mm:
                cur = next((d for d in truth.get('changed', []) if d['symbol'] == mm.group(2) and d['kind'] == mm.group(1)), None)
                self.fact(cur is not None, f"change {rel}: block names {mm.group(1)} {mm.group(2)} but `changed` on the same texts gives {sorted(tset)[:4]}")
                if cur and cur.get('target'):
                    r2 = subprocess.run([sys.executable, os.path.join(SCR, 'axiomcode-impact'), cur['target'], self.repo, '--json', '--depth', '12'] + (['--kind', cur['target_kind']] if cur.get('target_kind') and cur['target_kind'] != 'param' and '(' not in cur['target'] else []), capture_output=True, text=True)
                    try: cur['_impact'] = json.loads(r2.stdout)
                    except Exception: self.fact(False, f"change {rel}: impact failed for {cur['target']}: {(r2.stdout + r2.stderr).strip()[-160:]}"); cur = None
                continue
            if not cur or '_impact' not in cur: continue
            j = cur['_impact']
            m2 = re.match(r'    must change with it \((\d+)\): (.*)', l)
            if m2:
                self.fact(int(m2.group(1)) == len(j.get('contract', [])), f"change {cur['symbol']}: contract count {m2.group(1)} vs {len(j.get('contract', []))}")
                for nm in re.findall(r'(\S+) \(', m2.group(2)): self.fact(any(c['display'] == nm for c in j.get('contract', [])), f"change {cur['symbol']}: contract {nm} not in impact")
            m3 = re.match(r'    (produces / writes|reads / uses) it \((\d+)\): (.*)', l)
            if m3:
                roles = ('produces', 'writes') if m3.group(1).startswith('produces') else ('reads', 'uses')
                rows = [x for x in j.get('direct', []) if x['role'] in roles]
                self.fact(int(m3.group(2)) == len(rows), f"change {cur['symbol']}: {m3.group(1)} count {m3.group(2)} vs {len(rows)}")
                for nm in re.findall(r'(\S+) \S+:\d+', m3.group(3)): self.fact(any(x['display'] == nm for x in rows), f"change {cur['symbol']}: {nm} is not a {m3.group(1)} entry in impact")
            # the hop clause is optional because the line has carried one since the shim's depth was fixed — and
            # that is exactly how this check DIED: the wording gained "within 12 hops", the pattern did not, m4
            # stopped matching, and the one assertion about how many callables and tests the hook claims went
            # silent. A check that fails loudly is a check; a check that stops matching is nothing at all, and it
            # looks identical in the output. So an unmatched `reaches` line is now a FAILURE naming the line.
            m4 = re.match(r'    reaches (\d+) more callable\(s\) through resolved calls(?: within \d+ hops)?; (\d+) test\(s\)', l)
            if m4: self.fact(int(m4.group(1)) == len(j.get('reached', [])) and int(m4.group(2)) == len(j.get('tests', [])), f"change {cur['symbol']}: reach/tests {m4.group(1)}/{m4.group(2)} vs {len(j.get('reached', []))}/{len(j.get('tests', []))}")
            # …and the same guard for every other claim in the block, because they are the same construction and
            # would die the same silent way. A line that OPENS with one of these prefixes is a claim this check is
            # supposed to read; if none of the patterns took it, the wording moved and the assertion is gone.
            # The one legitimate non-match is the fast path's `reads / uses` line, which deliberately makes no
            # count claim (graph_sql answers from call_edges and cannot say what the rules would add), so it is
            # named here rather than swallowed by a looser pattern.
            claims = ('    must change with it', '    produces / writes it', '    reads / uses it', '    reaches ')
            if l.startswith(claims) and not (m2 or m3 or m4) and not l.startswith('    reads / uses it — resolved callers'):
                self.fact(False, f"change {cur['symbol']}: a claim line changed shape and this check stopped reading it — {l.strip()[:90]}")

def main(argv):
    # one run per repository at a time: the edits are made IN PLACE, so two runs interleaving is not slow, it is
    # a corrupted subject (see the restore note below).
    a = list(argv); n_reads = 30; n_greps = 30; n_edits = 12; replay = '--replay' in a; a = [x for x in a if x != '--replay']
    for flag in ('--reads', '--greps', '--edits'):
        if flag in a: i = a.index(flag); v = int(a[i + 1]); del a[i:i + 2]; n_reads, n_greps, n_edits = (v, n_greps, n_edits) if flag == '--reads' else (n_reads, v, n_edits) if flag == '--greps' else (n_reads, n_greps, v)
    repo = a[0] if a else '.'; V_ = V(repo); rnd = random.Random(7)
    lk = os.path.join(V_.repo, '.axiomcode', 'validate.lock')          # the lock the note above asks for
    if os.path.exists(lk) and time.time() - os.path.getmtime(lk) < 3600:
        print(f"another validate.py is already running on {V_.repo} — remove {lk} if it is not"); return 2
    os.makedirs(os.path.dirname(lk), exist_ok=True); open(lk, 'w').write(str(os.getpid()))
    atexit.register(lambda: os.path.exists(lk) and os.remove(lk))
    if replay:
        for l in open(os.path.join(V_.repo, '.axiomcode', 'hooks.jsonl')):
            e = json.loads(l)
            if not e.get('text') or 'input' not in e: continue
            inp = e['input']
            if e.get('as') == 'Read' and inp.get('file_path'):
                rel = os.path.relpath(os.path.realpath(inp['file_path']), V_.repo); a0 = int(inp.get('offset') or 1); V_.check_read(e['text'], rel, a0, a0 + int(inp.get('limit') or 100000))
            elif e.get('as') == 'Grep' and inp.get('pattern'): V_.check_grep(e['text'], re.sub(r'\W.*', '', inp['pattern']))
    else:
        files = [r[0] for r in V_.q("SELECT DISTINCT file FROM symbols WHERE method_id IS NOT NULL AND kind <> 'module' AND is_test = 0")]
        rnd.shuffle(files)
        for rel in files[:n_reads]:
            fp = os.path.join(V_.repo, rel)
            if not os.path.exists(fp): continue
            V_.check_read(hook('enrich.py', 'PostToolUse', 'Read', {'file_path': fp}, V_.repo), rel, 1, 100000)
            n = len(open(fp, errors='replace').read().split('\n')); a0 = rnd.randint(1, max(1, n - 40)); lim = rnd.choice([20, 60, 120])
            V_.check_read(hook('enrich.py', 'PostToolUse', 'Read', {'file_path': fp, 'offset': a0, 'limit': lim}, V_.repo), rel, a0, a0 + lim)
        names = [r[0] for r in V_.q("SELECT DISTINCT name FROM symbols WHERE method_id IS NOT NULL AND kind = 'method' AND length(name) > 4")]
        for nm in rnd.sample(names, min(n_greps, len(names))): V_.check_grep(hook('enrich.py', 'PostToolUse', 'Grep', {'pattern': nm}, V_.repo), nm)
        # edits: a body line, a signature (a parameter added), a field's type — applied to a copy of the file, PreToolUse and PostToolUse both
        meths = [dict(r) for r in V_.q("SELECT * FROM symbols WHERE method_id IS NOT NULL AND kind = 'method' AND is_test = 0 AND end_line - line >= 3")]
        fields = [dict(r) for r in V_.q("SELECT * FROM symbols WHERE method_id IS NULL AND type_id IS NULL AND kind IN ('field') AND is_test = 0 AND line > 0")]
        rnd.shuffle(meths); rnd.shuffle(fields); done = 0
        for s in meths[:n_edits * 2]:
            if done >= n_edits: break
            fp = os.path.join(V_.repo, s['file'])
            try: L = open(fp, errors='replace').read().split('\n')
            except OSError: continue
            hdr = L[s['line'] - 1]
            if '(' not in hdr: continue
            # A REAL `Edit` CALL MATCHES A UNIQUE STRING, and so must the edit this harness fabricates: the text is
            # applied with `.replace(old, new, 1)`, so a line that occurs twice in the file lands the edit on the
            # FIRST one and the block that comes back is about another declaration. Python makes that ordinary —
            # `    def get(self, request):` and `        from app.pricing import price_order` each occur twice in one
            # 50-line file here — and it produced three "no block for X" failures that were this harness's fault.
            uniq = lambda line: '\n'.join(L).count(line) == 1
            kind = rnd.choice(['signature', 'body'])
            if kind == 'signature':
                if not uniq(hdr): continue
                new_hdr = hdr.replace('(', '(int __added, ', 1) if not re.search(r'\(\s*\)', hdr) else hdr.replace('()', '(int __added)', 1); old_s, new_s = hdr, new_hdr
            else:
                hend = next((i for i in range(s['line'] - 1, min(s['end_line'], len(L))) if '{' in L[i]), s['line'] - 1)          # the header may span lines
                # and never a nested `def` / `function` line: editing one is a SIGNATURE change of the inner
                # declaration, which the hook is right to report and this loop would score as a body-only edit
                body = [i for i in range(hend + 1, min(s['end_line'] - 1, len(L))) if L[i].strip() and uniq(L[i])
                        # a comment or a docstring is NOT a body edit: `changed` deliberately reports nothing for
                        # a comment-only change (nothing depends on a comment), so asserting a block for one
                        # tests this harness's opinion rather than the tool's contract
                        and not L[i].strip().startswith(('//', '*', '/*', '}', '{', '@', '#', '"""', "'''"))
                        and not re.match(r'\s*(def |async def |function |class )', L[i])]
                if not body: continue
                i = rnd.choice(body); old_s, new_s = L[i], L[i] + ('  # __edited' if s['file'].endswith('.py') else ' // __edited')
            new_text = '\n'.join(L).replace(old_s, new_s, 1)
            if new_text == '\n'.join(L): continue
            blk = hook('changes.py', 'PreToolUse', 'Edit', {'file_path': fp, 'old_string': old_s, 'new_string': new_s}, V_.repo, session=f'v{done}')
            # a failure that does not say WHICH LINE it edited cannot be reproduced, and this harness exists to be
            # believed: three of its failures today were its own doing and took a by-hand replay to tell apart
            where = f"{s['file']}:{i + 1 if kind == 'body' else s['line']}: {old_s.strip()[:60]!r}"
            if kind == 'signature': V_.fact(bool(blk), f"PreToolUse: no block for a signature edit of {s['display']} ({where})")
            else: V_.fact(not blk, f"PreToolUse: a block for a body-only edit of {s['display']} ({where})")
            if blk: V_.check_change(blk, s['file'], '\n'.join(L), new_text)
            # after the edit lands: write the copy in place, run the PostToolUse block, restore
            # RESTORE FROM MEMORY, NOT FROM A .bak ON DISK. Two runs of this harness on one repository interleaved
            # their copy/move pairs, one restore consumed the other's backup, and the last writer left `# __edited`
            # sitting in the subject's source — where the next measurement would have taken it for the code. A
            # harness that edits a repository in place must be able to put it back without depending on a file.
            original = '\n'.join(L)
            open(fp, 'w').write(new_text)
            try:
                blk2 = hook('enrich.py', 'PostToolUse', 'Edit', {'file_path': fp, 'old_string': old_s, 'new_string': new_s}, V_.repo, session=f'w{done}')
                V_.fact(bool(blk2), f"PostToolUse: no block for a {kind} edit of {s['display']} ({s['file']}:{i + 1 if kind == 'body' else s['line']}: {old_s.strip()[:60]!r})")
                if blk2: V_.check_change(blk2, s['file'], '\n'.join(L), new_text)
            finally: open(fp, 'w').write(original)
            done += 1
        for f_ in fields[:max(2, n_edits // 3)]:
            fp = os.path.join(V_.repo, f_['file'])
            try: L = open(fp, errors='replace').read().split('\n')
            except OSError: continue
            ln = L[f_['line'] - 1]; m = re.match(r'^(\s*(?:\w+\s+)*?)([A-Za-z_][\w<>\[\],.? ]*?)\s+' + re.escape(f_['name']) + r'\b', ln)
            if not m: continue
            new_ln = ln.replace(m.group(2) + ' ' + f_['name'], 'Object ' + f_['name'], 1) if m.group(2) != 'Object' else ln.replace('Object ' + f_['name'], 'String ' + f_['name'], 1)
            if new_ln == ln: continue
            blk = hook('changes.py', 'PreToolUse', 'Edit', {'file_path': fp, 'old_string': ln, 'new_string': new_ln}, V_.repo, session='vf')
            V_.fact(bool(blk), f"PreToolUse: no block for a field-type edit of {f_['display']}")
            if blk: V_.check_change(blk, f_['file'], '\n'.join(L), '\n'.join(L).replace(ln, new_ln, 1))
    # ── the orientation block: the one hook surface nothing checked ──────────────────────────────────────────
    # orient.py fires on the FIRST PROMPT of a session and states where the task's own words land — "app <- order,
    # line, discount". Every part of that is checkable (the path is a directory the graph has declarations under,
    # and each word it carries occurs in a declaration's name there), and none of it was checked, on a block that
    # is in every agent's context before it opens a single file. Its once-per-session contract is checkable too.
    names = [r['name'] for r in V_.q("SELECT DISTINCT name FROM symbols WHERE method_id IS NOT NULL AND name NOT LIKE '<%' AND length(name) > 5 LIMIT 300")]
    words = []
    for n in names:                                                   # the graph's own words, not invented ones
        for w in re.findall(r'[a-z]{5,}', re.sub(r'([a-z])([A-Z])', r'\1 \2', n).lower()):
            if w not in words: words.append(w)
        if len(words) >= 3: break
    if len(words) >= 2:
        stamp = os.path.join(V_.repo, '.axiomcode', '.oriented')
        try: os.remove(stamp)
        except OSError: pass
        prompt = f"the {words[0]} is wrong when the {words[1]} is set, please look at it"
        blk = hook('orient.py', 'UserPromptSubmit', '', {}, V_.repo, session='orient', extra={'prompt': prompt})
        for ln in (blk or '').splitlines():
            m = re.match(r"\s+([\w./-]+)\s+<- (.+)$", ln)
            if not m: continue
            path, terms = m.group(1), [t.strip() for t in m.group(2).split(',') if t.strip()]
            under = [r['name'] for r in V_.q("SELECT name FROM symbols WHERE file LIKE ? AND name IS NOT NULL", path.rstrip('/') + '/%')]
            V_.fact(bool(under), f"orient: {path} has no declaration in the graph")
            for t in terms:
                V_.fact(any(t.lower() in (n or '').lower() for n in under),
                        f"orient: {path} <- {t!r}, but no declaration under it has that in its name")
        if blk:
            again = hook('orient.py', 'UserPromptSubmit', '', {}, V_.repo, session='orient', extra={'prompt': prompt})
            V_.fact(not again, "orient: a second prompt in the same session was oriented again (it is once per session)")
        try: os.remove(stamp)
        except OSError: pass

    print(f"{V_.checked} facts checked, {len(V_.wrong)} wrong")
    for w in V_.wrong[:40]: print("  ✗ " + w)
    return 1 if V_.wrong else 0

if __name__ == '__main__': sys.exit(main(sys.argv[1:]))
