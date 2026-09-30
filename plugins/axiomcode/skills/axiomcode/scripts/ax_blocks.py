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
WHOLE = 14               # a function this short is shown whole
AROUND = 3               # else: its header, then this many lines either side of the line that matters
FENCE = {'.py': 'python', '.java': 'java', '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
         '.mjs': 'javascript', '.cjs': 'javascript', '.cs': 'csharp', '.kt': 'kotlin', '.scala': 'scala'}
SITE = re.compile(r'^(?P<file>[^\s:][^:]*):(?P<line>\d+): ?(?P<code>.*?)(?:\s+\[(?P<tag>[^\]]*)\])?$')


class Graphs:
    """the enclosing callable of a line, from every graph the repository holds (one per language), or from the graph
    directories given (the baseline's, when an answer's lines are the baseline's)"""
    def __init__(self, repo, outs=None):
        out = os.path.join(repo, '.axiomcode', 'out')
        dbs = [os.path.join(o, 'graph.sqlite') for o in outs] if outs else \
              [os.path.join(out, d, 'graph.sqlite') for d in (sorted(os.listdir(out)) if os.path.isdir(out) else [])]
        self.cons = []
        for p in dbs:
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


def block(repo, f, marks, span, text=None):
    """the lines to show for the marked lines of file f: the enclosing callable (whole, or header + a window around
    each mark), numbered, every mark flagged. `text` is the file's text when the answer's lines are not the working
    tree's (the baseline's, for an edited file)"""
    if text is None:
        try:
            with open(os.path.join(repo, f), encoding='utf-8', errors='replace') as h: text = h.read()
        except OSError:
            return []
    L = text.split('\n')
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


def render(verb, doc, repo, graphs=None, text_of=None, drop=None):
    """the numbered places of a verb's --json document. `graphs` and `text_of` say where an answer's lines are when they
    are not the working tree's; `drop(tag)` leaves out rows the question does not want"""
    code = ax_grep.Code(repo)
    rows, _rest, foot = ax_grep.VERBS[{'find': 'context', 'tests': 'test-impact'}.get(verb, verb)](doc, code)
    sites = []
    for _k, line in rows:
        m = SITE.match(line)
        if m: sites.append((m.group('file'), int(m.group('line')), m.group('tag') or ''))
    sites = [x for x in sites if not any(w in x[2] for w in NOISE) and not (drop and drop(x[2]))]
    if any(FILLER not in t for _f, _n, t in sites): sites = [x for x in sites if FILLER not in x[2]]
    # ONE PLACE PER FUNCTION: two relevant lines of one function are one block with both marked, in the order the
    # verb ranked the first of them
    graphs = graphs or Graphs(repo); places = {}
    for f, n, t in sites:
        span = graphs.enclosing(f, n)
        key = (f, span[1], span[2]) if span else (f, n, n)
        p = places.setdefault(key, {'f': f, 'span': span, 'marks': [], 'tags': []})
        if n not in p['marks']: p['marks'].append(n)
        t = t.split(' — ')[0].strip()           # the tag's short form: what it is, not the explanation after the dash
        if t and t not in p['tags']: p['tags'].append(t)
    out = []
    for i, p in enumerate(list(places.values())[:CAP], 1):
        where = f"{p['f']}:{','.join(map(str, sorted(p['marks'])))}"
        out.append(f"{i}. {where}" + (f"  [{' | '.join(p['tags'][:2])}]" if p['tags'] else ''))
        body = block(repo, p['f'], p['marks'], p['span'], text_of(p['f']) if text_of else None)
        if body:
            out.append(f"   ```{FENCE.get(os.path.splitext(p['f'])[1], '')}")
            out += ['   ' + b for b in body]
            out.append('   ```')
    if not out: return None
    if len(places) > CAP: out.append(f"… {len(places) - CAP} more place(s) not shown — ask a narrower question to see them")
    out += [x for x in foot if x.startswith(('run:', 'verified'))][:2]
    return out


def verb_json(cmd):
    import ax_exec
    r = subprocess.run(ax_exec.program(cmd + ['--json']), stdout=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
    try: doc = json.loads(r.stdout)
    except ValueError: doc = None
    return r, doc


def git(repo, *a):
    r = subprocess.run(['git', *a], cwd=repo, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.stdout if r.returncode == 0 else ''


PLACE_LINE = re.compile(r'^\d+\. ')
SOURCE = re.compile(r'\.(py|pyi|java|cs|ts|tsx|mts|cts|js|jsx|mjs|cjs|kt|kts|scala)$')
GONE = ('removed',)


def old_name(c):
    """the name a removed or renamed declaration was written under; None for a whole file"""
    m = re.match(r'renamed (\S+) → ', str(c.get('detail') or ''))
    if m: return m.group(1)
    s = c.get('symbol') or ''
    if c.get('new_file') or '/' in s or '<' in s: return None
    return s.rsplit('.', 1)[-1].split('(')[0] or None


def is_gone(c):
    return c.get('kind') in GONE or str(c.get('detail') or '').startswith('renamed ')


def remaining(repo, name, where=None):
    """[(file, line)] of the source lines that still write `name` as a word: in the files `where` (the places that
    referenced it), and on any import line, anywhere. A type's name is looked for everywhere: it is its own word"""
    out = []
    for l in git(repo, 'grep', '-n', '-I', '-w', '--untracked', '-e', name).splitlines():
        f, _, rest = l.partition(':'); n, _, text = rest.partition(':')
        if not n.isdigit() or not SOURCE.search(f) or f.startswith('.axiomcode/'): continue
        imp = re.match(r'\s*(import|from|using|export|#include|require)\b', text) or re.search(r'\brequire\s*\(', text)
        if where is None or f in where or imp: out.append((f, int(n)))
    return out


def edits(repo):
    """impact with no name: what the working tree's edits changed, then what depends on those declarations, with code.

    The edit is read against the baseline, and its targets are the baseline graph's lines (axiomcode-changed): impact is
    asked of that same graph, as `changed --impact` does, so a target is never looked up in a graph where its line holds
    something else. A removed or renamed declaration is answered first by the references to its old name that remain
    (none left means the rename or delete is done), then by the places that referenced it."""
    import ax_fresh
    r, doc = verb_json(['python3', os.path.join(H, 'axiomcode-changed'), repo])
    if not isinstance(doc, dict):
        sys.stdout.write(r.stdout); return r.returncode
    ch = doc.get('changed') or []
    # the graph the targets are in: the baseline's, kept aside by a background refresh, while HEAD is where it was set
    bg = ax_fresh.baseline_graph(repo); bg = os.path.abspath(bg) if bg else None      # absolute: impact does not run where this does
    try: same_head = open(os.path.join(ax_fresh.out_dir(repo), 'base-commit')).read().strip() == (git(repo, 'rev-parse', 'HEAD').strip())
    except OSError: same_head = False
    env = dict(os.environ, AXIOMCODE_GRAPH=bg) if bg and same_head else None
    base_tree = ''
    if env:
        try: base_tree = open(os.path.join(ax_fresh.out_dir(repo), 'base-tree')).read().strip()
        except OSError: pass
    edited = {c.get('file') for c in ch if c.get('file')}
    def text_of(f):
        """the baseline's text of an edited file, whose lines the baseline graph's rows are in; None: the file on disk"""
        if not base_tree or f not in edited: return None
        t = git(repo, 'show', f'{base_tree}:{f}')
        return t or None
    graphs = Graphs(repo, [os.path.join(bg, 'out')]) if env else None
    # a file moved (`git mv`) is its declarations removed from the old path; the answer says where they went
    moved = {}
    for l in git(repo, 'diff', '--name-status', '-M', 'HEAD').splitlines():
        p = l.split('\t')
        if len(p) == 3 and p[0].startswith('R'): moved[p[1]] = p[2]
    # a removed type stands for its members: they are not listed again
    gone_types = {c['symbol'] for c in ch if c.get('kind') == 'removed' and c.get('target_kind') == 'type'}
    ch = [c for c in ch if not (c.get('kind') == 'removed' and any(c['symbol'].startswith(t + '.') for t in gone_types))]
    def said(c):
        what = f"{c.get('kind')} {c.get('shown_target') or c.get('symbol')}"
        det = str(c.get('detail') or '')
        if c.get('kind') == 'signature' and det and len(det) <= 60: what += f" ({det})"
        elif det.startswith('renamed '): what = f"renamed {c.get('shown_target') or c.get('symbol')} ({det.split(' (')[0][len('renamed '):]})"
        if c.get('kind') == 'removed' and c.get('file') in moved: what += f" (file moved to {moved[c['file']]})"
        return what
    head = ["your edits: " + (', '.join(said(c) for c in ch[:8]) or 'none') + (f" (+{len(ch) - 8} more)" if len(ch) > 8 else '')]
    targets = list(dict.fromkeys(c['target'] for c in ch if c.get('target') and not is_gone(c)))
    gone = [c for c in ch if c.get('target') and is_gone(c)]
    if not targets and not gone:
        print('\n'.join(head + ["nothing edited is a declaration other code depends on" if ch else
                                "no edits against the commit the graph was built from"]))
        return 0
    out = list(head)
    # the declaration a rename or a delete took away: the super-declaration it overrode does not have to change with it
    supers = lambda tag: tag.startswith('must change') and ('it overrides this' in tag or 'the method overrides this' in tag)
    for c in gone:
        name = old_name(c)
        _r, d = ask(repo, [c['target']], env)
        users = {(x.get('at') or '').rpartition(':')[0] for x in (d or {}).get('direct', [])} if isinstance(d, dict) else set()
        kind = c.get('target_kind')
        left = remaining(repo, name, None if kind == 'type' else users | {c.get('file')}) if name else []
        label = f"{name or c.get('symbol')} ({'renamed' if str(c.get('detail') or '').startswith('renamed ') else 'removed'})"
        if name and not left: out.append(f"{label}: no reference to {name} remains in the code")
        elif left:
            out.append(f"{label}: {len(left)} reference(s) to {name} remain; each must be edited:")
            out += render_sites(repo, [(f, n, 'still names it') for f, n in left])
        # the places that WROTE the name: a caller that reaches it only through a supertype, a test that reaches it hops
        # away, does not name it and has nothing to edit
        if isinstance(d, dict) and name:
            def names_it(x):
                f, _, n = (x.get('at') or '').rpartition(':')
                t = text_of(f) if text_of(f) is not None else (open(os.path.join(repo, f), encoding='utf-8', errors='replace').read() if os.path.isfile(os.path.join(repo, f)) else '')
                L = t.split('\n')
                return n.isdigit() and 0 < int(n) <= len(L) and re.search(rf'(?<![\w$]){re.escape(name)}(?![\w$])', L[int(n) - 1]) is not None
            shown = {f"{f}:{n}" for f, n in left}                                         # listed above already
            d = dict(d, direct=[x for x in d.get('direct', []) if names_it(x) and x.get('at') not in shown], tests=[], reached=[], stub_tests=[], external=[])
        lines = render('impact', d, repo, graphs, text_of, drop=supers) if isinstance(d, dict) else None
        if lines and any(PLACE_LINE.match(x) for x in lines):
            out.append(f"the places that referenced {name or c.get('symbol')}" + (" (already edited):" if left or name else ":")); out += lines
    if targets:
        _r, d = ask(repo, targets + ['--tests'], env)
        lines = render('impact', d, repo, graphs, text_of) if isinstance(d, dict) else None
        out += lines or [x for x in (d or {}).get('prose', [])] or [f"nothing in the graph depends on {', '.join(said(c) for c in ch if c.get('target') in targets)}"]
    print('\n'.join(out))
    return 0


def ask(repo, targets, env=None):
    """impact of the targets, as a --json document. A TARGET ONE EDIT PRINTED MUST NOT COST THE OTHERS THEIR ANSWER: asked
    together, one refused target (a parameter the file no longer declares) took every other edit's answer with it. On a
    refusal each is asked alone, and one still refused as the declaration it belongs to (`f.py:9(p)` as `f.py:9`)"""
    flags = [t for t in targets if t.startswith('--')]; ts = [t for t in targets if not t.startswith('--')]
    def one(xs):
        r = subprocess.run(__import__('ax_exec').program(['python3', os.path.join(H, 'axiomcode-impact')] + xs + [repo] + flags + ['--json']),
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', env=env)
        try: d = json.loads(r.stdout)
        except ValueError: d = None
        return r, d if isinstance(d, dict) and r.returncode in (0, 1) else None
    r, d = one(ts)
    if d is not None or len(ts) < 1: return r, d
    docs = []
    for t in ts:
        r1, d1 = one([t])
        if d1 is None and '(' in t: r1, d1 = one([re.sub(r'\(.*\)$', '', t)])
        if d1 is not None: docs.append(d1)
    if not docs: return r, None
    # the answers put together: every list of rows joined, the first document's other fields kept
    d = dict(docs[0])
    for x in docs[1:]:
        for k, v in x.items():
            if isinstance(v, list) and isinstance(d.get(k), list): d[k] = d[k] + [y for y in v if y not in d[k]]
    return r, d


def render_sites(repo, sites):
    """(file, line, tag) sites as numbered places with their code, in the order given"""
    graphs = Graphs(repo); places = {}
    for f, n, t in sites:
        span = graphs.enclosing(f, n)
        key = (f, span[1], span[2]) if span else (f, n, n)
        p = places.setdefault(key, {'f': f, 'span': span, 'marks': [], 'tags': [t]})
        if n not in p['marks']: p['marks'].append(n)
    out = []
    for i, p in enumerate(list(places.values())[:CAP], 1):
        out.append(f"{i}. {p['f']}:{','.join(map(str, sorted(p['marks'])))}  [{' | '.join(p['tags'][:2])}]")
        body = block(repo, p['f'], p['marks'], p['span'])
        if body:
            out.append(f"   ```{FENCE.get(os.path.splitext(p['f'])[1], '')}")
            out += ['   ' + b for b in body]
            out.append('   ```')
    if len(places) > CAP: out.append(f"… {len(places) - CAP} more place(s) not shown")
    return out


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
