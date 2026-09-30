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
WIDTH = 200              # a printed source line is cut here
LONG = 1000              # a file with a line this long near a mark is generated or minified, and is not shown as code
GENERATED_EXT = ('.html', '.htm', '.xhtml', '.svg', '.xml', '.map', '.min.js', '.min.css', '.lock', '.ipynb')
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
    # GENERATED OR MINIFIED TEXT IS NOT CODE TO READ: an HTML report under docs/ was one 219 KB line, printed whole
    if generated(f, L, marks): return []
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
        t = L[i - 1].rstrip()
        if len(t) > WIDTH: t = t[:WIDTH - 1] + '…'                      # every printed line is capped
        out.append(f"{'→' if i in marks else ' '} {str(i).rjust(w)}  {t}")
        prev = i
    return out


def generated(f, L, marks):
    """is this file's text generated or minified (a report, a bundle, a map), not code a person writes and reads"""
    if f.lower().endswith(GENERATED_EXT): return True
    return any(len(L[n - 1]) > LONG for n in marks if 0 < n <= len(L))


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
    whole = {}                                                          # a file named as a whole: no line, no code
    for _k, line in rows:
        m = SITE.match(line)
        if not m: continue
        # `f:1: (edited test file)`, `f:1: (names x)`: a row about the FILE, which line 1 does not show
        if m.group('line') == '1' and re.fullmatch(r'\(.*\)', (m.group('code') or '').strip()):
            whole.setdefault(m.group('file'), (m.group('code').strip('()'), m.group('tag') or '')); continue
        sites.append((m.group('file'), int(m.group('line')), m.group('tag') or ''))
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
        t = re.sub(r'\s*·?\s*hop None\b', '', t).strip(' ·')           # a hop count the graph does not have is not printed
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
    n = len(out and [x for x in out if PLACE_LINE.match(x)])
    for f, (what, tag) in whole.items():
        if n >= CAP: break
        if any(p['f'] == f for p in places.values()): continue
        n += 1; out.append(f"{n}. {f}  [{what}{' · ' + tag if tag else ''}]")
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


def test_impact_module():
    import importlib.machinery, importlib.util
    spec = importlib.util.spec_from_loader('axtests', importlib.machinery.SourceFileLoader('axtests', os.path.join(H, 'axiomcode-test-impact')))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


LANG_OF = {'.py': 'python', '.java': 'java', '.cs': 'csharp', '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript',
           '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript'}


def run_lines(doc, repo):
    """RUN WHAT THE ANSWER LISTS: one `run:` line per language, built from every test the answer names (its places and
    the files it names whole), with the project's own build tool. The verb's own command could keep fewer than it
    listed (1 of 6 classes), or name Maven in a Gradle build"""
    files, classes = {}, {}
    for t in doc.get('tests', []):
        f = (t.get('at') or '').rpartition(':')[0]
        if not f: continue
        l = LANG_OF.get(os.path.splitext(f)[1])
        if not l: continue
        files.setdefault(l, []).append(f)
        owner = (t.get('display') or '').rsplit('.', 1)[0] if '.' in (t.get('display') or '') else ''
        if owner and l in ('java', 'csharp'): classes.setdefault(l, []).append(owner.split('.')[-1])
    for f in doc.get('edited_test_files', []) or []:
        l = LANG_OF.get(os.path.splitext(f)[1])
        if l: files.setdefault(l, []).append(f)
    if not files: return None
    try: T = test_impact_module()
    except Exception: return None
    db = os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')
    out = []
    for l, fs in files.items():
        fs = list(dict.fromkeys(fs))
        try:
            if l in ('java', 'csharp'):
                # every class listed, and every test file's own class (a Java or C# test class is its file)
                names = list(dict.fromkeys(classes.get(l, []) + [os.path.splitext(os.path.basename(f))[0] for f in fs]))
                c = T.java_command(repo, fs, names) if l == 'java' else T.command_for(l, fs, names, None, repo)
            else:
                c = T.command_for(l, fs, [], None, repo)
        except Exception:
            c = None
        if c: out += [f"run: {x}" for x in c.split('\n') if x.strip()]
    return out or None


# a web handler: where a request arrives by its route, which the graph does not follow from a client
HANDLER = re.compile(r'@(Get|Post|Put|Patch|Delete|Request)Mapping\b|\[(Http(Get|Post|Put|Patch|Delete)|Route)\b|\.Map(Get|Post|Put|Patch|Delete|Methods)?\s*\(|'
                     r'@(app|router|bp|blueprint|api)\.(route|get|post|put|patch|delete)\b|\bpath\s*\(\s*[\'"]|@api_view\b|\bAPIView\b|\bViewSet\b|\bControllerBase\b|@(Rest)?Controller\b')
# a test that drives the application over HTTP
HTTP_CLIENT = re.compile(r'\.(Get|Post|Put|Patch|Delete|Send)Async\s*\(|\bHttpClient\b|\bWebApplicationFactory\b|\bMockMvc\b|\bTestRestTemplate\b|'
                         r'\bWebTestClient\b|\bRestAssured\b|\bgiven\(\)\s*\.|\bself\.client\.(get|post|put|patch|delete)\s*\(|\bAPIClient\b|\bTestClient\b|'
                         r'\bclient\.(get|post|put|patch|delete)\s*\(')


def http_note(doc, repo):
    """ONE LINE WHEN THE EDIT IS IN A WEB HANDLER and tests drive the application over HTTP: those tests reach it through
    a request the graph does not follow, so they are not in the answer. It says how many there are and how to find them"""
    edited = {c.get('file') for c in doc.get('changed', []) if isinstance(c, dict) and c.get('file')}
    edited |= {(c.get('target') or '').rpartition(':')[0] for c in doc.get('changed', []) if isinstance(c, dict)}
    edited = {f for f in edited if f and os.path.isfile(os.path.join(repo, f))}
    handlers = [f for f in edited if HANDLER.search(open(os.path.join(repo, f), encoding='utf-8', errors='replace').read())]
    if not handlers: return None
    listed = {(t.get('at') or '').rpartition(':')[0] for t in doc.get('tests', [])}
    hits = []
    TESTISH = re.compile(r'(^|/)(tests?|spec|__tests__)(/|$)|[Tt]ests?\.|_test\.|(^|/)test_|\.[Tt]ests?/|IntegrationTest|IT\.')
    for l in git(repo, 'ls-files', '--cached', '--others', '--exclude-standard').splitlines()[:20000]:
        if l in listed or not SOURCE.search(l) or not TESTISH.search(l): continue
        try: t = open(os.path.join(repo, l), encoding='utf-8', errors='replace').read()
        except OSError: continue
        if HTTP_CLIENT.search(t): hits.append(l)
    if not hits: return None
    return (f"not traced: {len(hits)} test file(s) drive the application over HTTP ({', '.join(hits[:3])}{' …' if len(hits) > 3 else ''}); "
            f"a request is not followed to {os.path.basename(handlers[0])}'s handler, so they are not listed above. "
            f"Find the ones that reach it by the route the handler serves: grep the tests for that path")


def empty_sentence(verb, doc):
    """an answer with no place in it, said in a sentence (never the verb's JSON document)"""
    if verb == 'tests':
        ch = [c.get('symbol') for c in doc.get('changed', []) if isinstance(c, dict) and c.get('symbol')]
        if not ch: return ["no edits against the commit the graph was built from, so no test is selected"]
        out = [f"no test reaches your edits ({', '.join(ch[:4])}{' …' if len(ch) > 4 else ''}) through the graph. "
               "That is not the same as no test covering them: a call the graph could not resolve is unknown, not absent."]
        by_name = doc.get('same_name_only') or []
        if by_name:
            out.append(f"named after the changed file, not reached through the graph: {', '.join(by_name[:4])}")
        pkg = sorted({f for fs in (doc.get('same_package_only') or {}).values() for f in fs} - set(by_name))
        if pkg: out.append(f"in the same package, weaker still: {', '.join(pkg[:4])}{' …' if len(pkg) > 4 else ''}")
        return out
    if verb == 'impact':
        t = ', '.join(x.get('label') or '' for x in doc.get('targets', []) if isinstance(x, dict)) or 'it'
        return [f"nothing in the graph calls, reads or extends {t}. A call the graph could not resolve is unknown, not absent: "
                "never report \"no callers\" from this alone."]
    if verb == 'path':
        return ["no call chain between the two in the graph. A call the graph could not resolve is unknown, not absent."]
    return ["no place in the graph matches this question"]


def import_sites(repo, doc):
    """the import lines that name the target, for `impact <name>`: a rename or a delete must edit them too, and the call
    graph has no edge for an import"""
    names = set()
    for t in doc.get('targets', []) if isinstance(doc.get('targets'), list) else []:
        m = re.match(r'(?:class|interface|enum|method|function|field|type|record|struct)?\s*([\w$.]+)', (t.get('label') or '').strip()) if isinstance(t, dict) else None
        if m: names.add(m.group(1).split('.')[-1].split('(')[0])
    out = []
    for n in names:
        if not n or len(n) < 3: continue
        for l in git(repo, 'grep', '-n', '-I', '-w', '-e', n).splitlines():
            f, _, rest = l.partition(':'); k, _, text = rest.partition(':')
            if k.isdigit() and SOURCE.search(f) and not f.startswith('.axiomcode/') and \
               re.match(r'\s*(from\s+\S+\s+import|import|using|export\s*\{)\b', text):
                out.append((f, int(k), 'imports it'))
    return out


def main(argv):
    verb, repo = argv[0], argv[1]
    if verb == 'edits': return edits(repo)
    cmd = argv[3:] if len(argv) > 2 and argv[2] == '--' else argv[2:]
    r, doc = verb_json(cmd)
    if not isinstance(doc, dict):
        sys.stdout.write(r.stdout); return r.returncode
    if verb == 'find':
        # a method called on a receiver (`file.read()`, `obj.save()`) is some type's own, not code the task has to write
        doc['called_undeclared'] = [u for u in doc.get('called_undeclared', [])
                                    if not re.search(rf'(?<!self)(?<!this)\.\s*{re.escape(u.get("name") or "")}\s*\(', u.get('code') or '')]
    lines = render(verb, doc, repo) if r.returncode in (0, 1) or doc.get('called_undeclared') else None
    if lines is not None and verb == 'impact':
        # the import lines that name it, among the places: the graph records no edge for an import
        shown = set(re.findall(r'^\d+\. (\S+?):([\d,]+)', '\n'.join(lines), re.M))
        have = {(f, int(n)) for f, ns in shown for n in ns.split(',')}
        imp = [x for x in import_sites(repo, doc) if (x[0], x[1]) not in have]
        if imp:
            k = next((i for i, x in enumerate(lines) if not PLACE_LINE.match(x) and not x.startswith('   ')), len(lines))
            extra = render_sites(repo, imp)
            base = sum(1 for x in lines if PLACE_LINE.match(x))
            extra = [re.sub(r'^(\d+)\. ', lambda m: f"{int(m.group(1)) + base}. ", x) if PLACE_LINE.match(x) else x for x in extra]
            lines = lines[:k] + extra + lines[k:]
    if verb == 'tests' and lines is not None:
        rl = run_lines(doc, repo)
        if rl: lines = [x for x in lines if not x.startswith('run:')] + rl
    if lines is None:
        # a refusal: the verb's own words are the answer; an answer with no place in it: a sentence
        prose = doc.get('prose') or []
        if r.returncode not in (0, 1) and prose: print('\n'.join(prose)); return r.returncode
        lines = empty_sentence(verb, doc)
        if verb == 'tests':
            by_name = doc.get('same_name_only') or []
            c = None
            if by_name:
                c = run_lines({'tests': [{'at': f + ':1'} for f in by_name]}, repo)
            lines += c or []
    if verb == 'tests':
        note = http_note(doc, repo)
        if note: lines = [x for x in lines if not x.startswith('run:')] + [note] + [x for x in lines if x.startswith('run:')]
    print('\n'.join(lines))
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 3 or (sys.argv[1] != 'edits' and len(sys.argv) < 4): sys.exit(__doc__)
    sys.exit(main(sys.argv[1:]))
