#!/usr/bin/env python3
"""ax_blocks.py <find|impact|path|tests> <repo> -- <verb command…>   ·   ax_blocks.py edits <repo>  — an answer as numbered places, each with its code.

    1. src/shop/pricing.py:6  [by name · in total]
       ```python
         4  def total(items):
         5      net = sum(i.price for i in items)
       → 6      return apply_discount(net) * (1 + vat_rate())
       ```

An agent that is given a location reads the file next, so each place carries the function that encloses it: the whole
function when it is short, else its header and the lines around the one that matters. The verb runs with --json and
its sites are taken in the grep view's order (ax_grep), so the three answers rank exactly as the verbs do; at most CAP
places are shown and the rest counted. A verb that refuses, or finds no place, is printed as the verb said it.
"""
import json, os, re, sqlite3, subprocess, sys
H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, H)
import ax_grep

CAP = 10                 # places shown; the rest are counted
FAR = 8                  # places more than one hop away, named without code
DIRECT_CODE = 3          # direct callers shown with code even when a word grep also finds them
PLAIN_WHY = ('calls it', 'reads it', 'writes it', 'writes/reads it', 'references it', 'instantiates it')
WHOLE = 14               # a function this short is shown whole
AROUND = 3               # else: its header, then this many lines either side of the line that matters
FENCE = {'.py': 'python', '.java': 'java', '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
         '.mjs': 'javascript', '.cjs': 'javascript', '.cs': 'csharp', '.kt': 'kotlin', '.scala': 'scala'}
SITE = re.compile(r'^(?P<file>[^\s:][^:]*):(?P<line>\d+): ?(?P<code>.*?)(?:\s+\[(?P<tag>[^\]]*)\])?$')


class Graphs:
    """the enclosing callable of a line, from every graph the repository holds (one per language)"""
    def __init__(self, repo):
        out = os.path.join(repo, '.axiomcode', 'out')
        self.cons = []
        for d in sorted(os.listdir(out)) if os.path.isdir(out) else []:
            p = os.path.join(out, d, 'graph.sqlite')
            if os.path.isfile(p):
                try: self.cons.append(sqlite3.connect(f"file:{p}?mode=ro", uri=True))
                except sqlite3.Error: pass

    def enclosing(self, f, n):
        best = None
        for c in self.cons:
            try:
                r = c.execute("SELECT display, line, end_line FROM symbols WHERE (file = ? OR file LIKE ?) AND line <= ? AND end_line >= ? "
                              "AND method_id IS NOT NULL AND display NOT LIKE '%<module>%' ORDER BY end_line - line LIMIT 1",
                              (f, '%/' + f, n, n)).fetchone()
            except sqlite3.Error:
                continue
            if r and (best is None or r[2] - r[1] < best[2] - best[1]): best = r
        return best


def block(repo, f, marks, span):
    """the lines to show for the marked lines of file f: the enclosing callable (whole, or header + a window around
    each mark), numbered, every mark flagged"""
    try:
        with open(os.path.join(repo, f), encoding='utf-8', errors='replace') as h: L = h.read().split('\n')
    except OSError:
        return []
    marks = sorted(n for n in marks if 0 < n <= len(L))
    if not marks: return []
    lo, hi = (span[1], span[2]) if span else (marks[0], marks[-1])
    lo, hi = max(1, min(lo, marks[0])), min(len(L), max(hi, marks[-1]))
    if hi - lo + 1 <= WHOLE:
        keep = list(range(lo, hi + 1))
    else:
        keep = {lo}
        for n in marks: keep |= set(range(max(lo, n - AROUND), min(hi, n + AROUND) + 1))
        keep = sorted(keep)
    w = len(str(keep[-1])); out = []; prev = None
    for i in keep:
        if prev is not None and i != prev + 1: out.append(' ' * (w + 4) + '…')
        out.append(f"{'→' if i in marks else ' '} {str(i).rjust(w)}  {L[i - 1].rstrip()}")
        prev = i
    return out


# rows that add nothing an agent acts on: a word match offered only because nothing better was found (dropped when a
# better row exists), and a module's own scope (its import lines)
FILLER = 'best overall match'
NOISE = ('module scope',)


def render(verb, doc, repo):
    code = ax_grep.Code(repo)
    rows, _rest, foot = ax_grep.VERBS[{'find': 'context', 'tests': 'test-impact'}.get(verb, verb)](doc, code)
    sites = []
    for _k, line in rows:
        m = SITE.match(line)
        if m: sites.append((m.group('file'), int(m.group('line')), m.group('tag') or ''))
    sites = [x for x in sites if not any(w in x[2] for w in NOISE)]
    if any(FILLER not in t for _f, _n, t in sites): sites = [x for x in sites if FILLER not in x[2]]
    # ONE PLACE PER FUNCTION: two relevant lines of one function are one block with both marked, in the order the
    # verb ranked the first of them
    graphs = Graphs(repo); places = {}
    for f, n, t in sites:
        span = graphs.enclosing(f, n)
        key = (f, span[1], span[2]) if span else (f, n, n)
        p = places.setdefault(key, {'f': f, 'span': span, 'marks': [], 'tags': []})
        if n not in p['marks']: p['marks'].append(n)
        t = t.split(' — ')[0].strip()           # the tag's short form: what it is, not the explanation after the dash
        if t and t not in p['tags']: p['tags'].append(t)
    # GREP AIDS, IT IS NOT REPLACED. For impact, a place whose lines spell the target's name is one the agent's own
    # `grep -nw NAME` finds: it is listed by location only, and the code goes to the places no text search reaches
    # (a function passed as a value, a framework or DI registration, an alias). Off with AXIOMCODE_GREP_AID=0.
    plain = []
    names = target_names(doc) if verb == 'impact' and os.environ.get('AXIOMCODE_GREP_AID', '1').lower() not in ('0', 'off', 'false') else []
    if names:
        # WHY each direct place depends on it: a plain resolved call, read or write is what a word grep finds too; a call
        # across a process boundary, an override or implementation, an injection or a call through a field holding it is
        # a link grep cannot make, so it keeps its code and says what it is
        why = {}
        for r in doc.get('direct') or []:
            for x in [r] + list(r.get('reasons') or []):
                if x.get('at'): why.setdefault(x['at'], (x.get('why') or r.get('why') or '', x.get('certainty') or r.get('certainty') or 'resolved'))
        for p in places.values():
            for n in p['marks']:
                w = why.get(f"{p['f']}:{n}")
                if w and w[0] and w[0] not in PLAIN_WHY and w[0].split(' — ')[0].split(' (')[0] not in p['tags']: p['tags'].insert(0, w[0].split(' — ')[0].split(' (')[0])
        def greppable(p):
            ws = [why.get(f"{p['f']}:{n}") for n in p['marks']]
            return all(w and w[0] in PLAIN_WHY and w[1] in ('resolved', 'sound') for w in ws) and \
                   all(any(re.search(r'(?<![\w$])' + re.escape(nm) + r'(?![\w$])', statement(repo, p['f'], n)) for nm in names) for n in p['marks'])
        # the first few direct callers keep their code even when grep finds them: they are what an agent checks first
        keep = 0
        for k, p in list(places.items()):
            if greppable(p):
                if keep < DIRECT_CODE: keep += 1; continue
                plain.append(p); del places[k]
    # A PLACE FURTHER THAN ONE HOP AWAY IS NAMED, NOT SHOWN: no text search finds it, so it stays in the answer, but the
    # function it sits in says enough; code goes to the direct places the agent will actually edit or check
    far, tests = [], []
    if names:
        is_far = lambda p: any(re.search(r'\bhop \d', t) for t in p['tags'])
        is_test = lambda p: any(re.search(r'(^|· )test\b', t) for t in p['tags'])
        tests = [p for p in places.values() if is_test(p)]
        far = [p for p in places.values() if is_far(p) and not is_test(p)]
        places = {k: p for k, p in places.items() if not is_far(p) and not is_test(p)}
    out = []
    for i, p in enumerate(list(places.values())[:CAP], 1):
        where = f"{p['f']}:{','.join(map(str, sorted(p['marks'])))}"
        out.append(f"{i}. {where}" + (f"  [{' | '.join(p['tags'][:2])}]" if p['tags'] else ''))
        body = block(repo, p['f'], p['marks'], p['span'])
        if body:
            out.append(f"   ```{FENCE.get(os.path.splitext(p['f'])[1], '')}")
            out += ['   ' + b for b in body]
            out.append('   ```')
    if far:
        out.append(f"further away ({len(far)} place(s), reached through {'the places above' if places or plain else 'its callers'}; no code shown):")
        for p in far[:FAR]:
            fn = (p['span'][0] if p['span'] else '?')
            out.append(f"   {p['f']}:{','.join(map(str, sorted(p['marks'])))}  {fn}  [{p['tags'][0]}]")
        if len(far) > FAR: out.append(f"   … +{len(far) - FAR} more")
    if tests:
        out.append(f"tests that reach it ({len(tests)}; no code shown):")
        for p in tests[:FAR]:
            out.append(f"   {p['f']}:{','.join(map(str, sorted(p['marks'])))}  {p['span'][0] if p['span'] else '?'}")
        if len(tests) > FAR: out.append(f"   … +{len(tests) - FAR} more")
    if plain:
        refs = [f"{p['f']}:{','.join(map(str, sorted(p['marks'])))}" for p in plain]
        g = ' -e '.join(names)
        out.append(f"+{len(plain)} more direct caller(s) `grep -nw {g}` also finds "
                   f"(confirmed callers; no code shown): " + ', '.join(refs[:8]) + (f" +{len(refs) - 8}" if len(refs) > 8 else ''))
        other = grep_others(repo, names, {(p['f'], n) for p in plain for n in p['marks']})
        if other: out.append(f"  {other} other line(s) grep matches for that name are NOT this declaration (another symbol of the same name, or text)")
    if not out: return None
    if len(places) > CAP: out.append(f"… {len(places) - CAP} more place(s) not shown — ask a narrower question to see them")
    out += [x for x in foot if x.startswith(('run:', 'verified'))][:2]
    return out


def target_names(doc):
    """the short names of the declarations impact was asked about: `isOrderable (4 declarations)`, `Shop.Cart#total` -> total"""
    out = []
    for t in doc.get('targets') or []:
        lab = str(t.get('label') or t.get('display') or '').split(' (')[0].strip()
        nm = re.split(r'[.#:]', lab)[-1].split('(')[0].strip()
        if re.fullmatch(r'[A-Za-z_$][\w$]*', nm or '') and nm not in out: out.append(nm)
    return out


_SRC = {}
def source_line(repo, f, n):
    if f not in _SRC:
        try:
            with open(os.path.join(repo, f), encoding='utf-8', errors='replace') as h: _SRC[f] = h.read().split('\n')
        except OSError: _SRC[f] = []
    L = _SRC[f]
    return L[n - 1] if 0 < n <= len(L) else ''


def statement(repo, f, n):
    """the statement a call starts on: up to the line that ends it (`rows\\n  .sort(byPath);`), at most 5 lines"""
    out = []
    for i in range(n, n + 5):
        l = source_line(repo, f, i); out.append(l)
        if l.rstrip().endswith((';', '{', '}')) or not l.strip(): break
    return '\n'.join(out)


def grep_others(repo, names, confirmed):
    """how many lines a word grep for the name matches that are neither a confirmed place nor a declaration of it"""
    try:
        r = subprocess.run(['git', 'grep', '-nw'] + sum((['-e', nm] for nm in names), []), cwd=repo, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return 0
    n = 0
    for ln in r.stdout.splitlines():
        m = re.match(r'([^:]+):(\d+):(.*)', ln)
        if not m or (m.group(1), int(m.group(2))) in confirmed: continue
        if re.search(r'\b(def|function|class|interface|async|public|private|protected|static|const|let|var)\b[^=(]*\b(' + '|'.join(map(re.escape, names)) + r')\b', m.group(3)): continue
        if re.match(r'\s*(' + '|'.join(map(re.escape, names)) + r')\s*\(.*\)\s*[:{]', m.group(3)): continue   # a method declaration
        n += 1
    return n


def verb_json(cmd):
    import ax_exec
    r = subprocess.run(ax_exec.program(cmd + ['--json']), stdout=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
    try: doc = json.loads(r.stdout)
    except ValueError: doc = None
    return r, doc


def edits(repo):
    """impact with no name: what the working tree's edits changed, then what depends on those declarations, with code"""
    r, doc = verb_json(['python3', os.path.join(H, 'axiomcode-changed'), repo])
    if not isinstance(doc, dict):
        sys.stdout.write(r.stdout); return r.returncode
    ch = doc.get('changed') or []
    targets = list(dict.fromkeys(c['target'] for c in ch if c.get('target')))
    head = ["your edits: " + (', '.join(f"{c.get('kind')} {c.get('shown_target') or c.get('symbol')}" for c in ch[:8]) or 'none')
            + (f" (+{len(ch) - 8} more)" if len(ch) > 8 else '')]
    if not targets:
        print('\n'.join(head + ["nothing edited is a declaration other code depends on" if ch else
                                "no edits against the commit the graph was built from"]))
        return 0
    r, doc = verb_json(['python3', os.path.join(H, 'axiomcode-impact')] + targets + [repo, '--tests'])
    lines = render('impact', doc, repo) if isinstance(doc, dict) else None
    print('\n'.join(head + (lines or [x for x in (doc or {}).get('prose', [])] or [r.stdout.strip()])))
    return 0


def main(argv):
    verb, repo = argv[0], argv[1]
    if verb == 'edits': return edits(repo)
    cmd = argv[3:] if len(argv) > 2 and argv[2] == '--' else argv[2:]
    r, doc = verb_json(cmd)
    if not isinstance(doc, dict):
        sys.stdout.write(r.stdout); return r.returncode
    lines = render(verb, doc, repo) if r.returncode in (0, 1) or doc.get('called_undeclared') else None
    if lines is None:
        # a refusal or an answer with no place in it: the verb's own words are the answer
        print('\n'.join(doc.get('prose') or []) or r.stdout.strip()); return r.returncode
    print('\n'.join(lines))
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 3 or (sys.argv[1] != 'edits' and len(sys.argv) < 4): sys.exit(__doc__)
    sys.exit(main(sys.argv[1:]))
