#!/usr/bin/env python3
"""ax_grep.py <verb> <repo> [--limit N] -- <verb command…>  — an answer as sites, one per line, the way grep prints them.

    path:line: <the code on that line>  [what the graph knows about it]

An agent reads grep output without effort: one hit per line, the location first, the code it will act on after it. The
verbs' prose answers carry the same sites inside sections, headers and explanations, and when the answer is a LIST OF
SITES (who calls this, what reaches that, the hops of a chain, the tests to run) that prose is mostly the fan-out an
agent has to wade through. So the verb is run with --json, the same answer as a document, and its sites are printed:

  impact        must-change-with-it, then direct dependents surest first, then what reaches them by hop, then the tests;
                an `alongside` row (no call, no reference) and a text mention written as prose are counted, never listed
  path          every hop of each chain at the line the call is written on; `path '*' X` the declarations that reach X
  context       the call flow's steps (or, with no flow, the entry points and the declarations named per file), then the
                text files that name them; in a repository in several languages, the graphs where the task's words land
  test-impact   the tests, nearest first, and the command that runs them

The tag is the graph's knowledge, in its own words: [resolved] · [one of a set] · [registered] · [by name] · [text] ·
hop N · test. The first --limit (default 30) sites are printed and the rest counted by kind; the last lines say whether
the answer was verified and what it cannot see. The verbose answer is the verb without --grep (MCP full=True).
A verb that refuses (no such name, no graph), or answers with no site at all (no chain, no dependent), is printed
exactly as the verb said it: there the reason is the answer.
"""
import json, os, re, subprocess, sys

H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, H)
import ax_edges, ax_evidence

CAP = 30
TEXT_ROWS = 5                  # rows of a name written in a non-source file: leads, so a few and a count
CODE_WIDTH = 140
# a certainty word as the answers print it, keyed by the word the --json document carries
TAG = {'sound': 'resolved', 'entry': 'entry', None: 'resolved'}


class Code:
    """the text of a line of a file under the repository, read once per file"""
    def __init__(self, repo):
        self.repo, self.files = repo, {}

    def line(self, at):
        f, _, n = (at or '').rpartition(':')
        if not f or not n.isdigit(): return None
        if f not in self.files:
            try:
                with open(os.path.join(self.repo, f), encoding='utf-8', errors='replace') as h: self.files[f] = h.read().split('\n')
            except OSError: self.files[f] = None
        L = self.files[f]; i = int(n)
        if not L or not 0 < i <= len(L): return None
        s = L[i - 1].strip()
        return s if len(s) <= CODE_WIDTH else s[:CODE_WIDTH - 1] + '…'


def site(code, at, tag, name=''):
    """one row: path:line: code  [tag]. With no readable line the declaration's name stands in for the code."""
    text = code.line(at)
    if text is None: text = name or ''
    # (not a `<module>` / `<arrow>` / `<lambda>`: the line itself is all there is to say of those)
    elif name and '<' not in name and not re.search(r'\b' + re.escape(name.split('.')[-1].split('(')[0]) + r'\b', text):
        tag = f"{tag} · {name}" if tag else name        # the line does not show whose it is (a decorator, a wrapped call)
    return f"{at}: {text}  [{tag}]" if tag else f"{at}: {text}"


def stale(r):
    return ' · may be out of date' if isinstance(r, dict) and r.get('stale') else ''


def n_sites(r):
    n = r.get('sites') or 1
    return f" ×{n}" if n > 1 else ''


def per_test_file(tests):
    """the tests one row per test FILE, its nearest test first, with how many more that file holds. A test file is what
    gets run, and a route through a module's import reaches every test in it: listed one by one, the 30 tests of one
    file were the whole capped answer and pushed out everything the change reaches"""
    first, n = {}, {}
    for t in tests:
        f = (t.get('at') or '').rpartition(':')[0]
        n[f] = n.get(f, 0) + 1
        first.setdefault(f, t)
    return [(t, n[f] - 1) for f, t in first.items()]


def more_in_file(k):
    return f" · +{k} more in this file" if k else ''


def ev(row, r):
    """a row and, when it carries evidence (ax_evidence.py), the line that decides it under it: one entry, so a cap
    never separates them"""
    return row + ''.join('\n' + l for l in ax_evidence.lines(r, call=False)) if r.get('evidence') else row


def ev_foot(d):
    n = d.get('evidence_more')
    out = [f"evidence: the {ax_evidence.TOP} strongest non-exact rows carry the line that decides them, {n} more do not"] if n else []
    rows = d.get('direct', []) + d.get('tests', []) + [h for a in d.get('answers', []) for h in a.get('hops', [])]
    if any(r.get('only_through') for r in rows if isinstance(r, dict)): out.append(ax_evidence.DROP_HINT)
    return out


# ── impact ───────────────────────────────────────────────────────────────────────────────────────────────────────────
def impact(d, code):
    rows, rest = [], {}
    def more(k, n=1): rest[k] = rest.get(k, 0) + n
    for r in d.get('contract', []):
        rows.append(('contract', site(code, r['at'], f"must change · {r['why']}{stale(r)}", r['display'])))
    seen = set()
    if d.get('alongside'): more('alongside (no call, no reference)', len(d['alongside']))
    if d.get('alongside_count'): more('alongside (no call, no reference; --alongside lists them)', d['alongside_count'])
    if d.get('asked_again'): rows.append(('note', d['asked_again']['note']))
    # a row with evidence leads its rung: it is one of the strongest, and the cap must not cut it from its evidence
    direct = d.get('direct', [])
    if any(r.get('evidence') for r in direct):
        rung = {}
        for i, r in enumerate(direct): rung.setdefault(r.get('certainty'), i)
        direct = sorted(direct, key=lambda r: (rung[r.get('certainty')], not r.get('evidence')))
    # a name match on a package's value (`request(app).get(…)`, ax_edges.library_receiver_sites) is the weakest lead:
    # it goes after every other row, so the first page holds the callers that may really be the target's
    libs = []
    for r in direct:
        cert = r.get('certainty') or 'resolved'
        if cert == 'alongside': more('alongside (no call, no reference)'); continue
        seen.add(r['id'])
        if r.get('why') == ax_edges.LIBRARY_BYNAME_WHY:
            libs.append(('library receiver', site(code, r['at'], f"{TAG.get(cert, cert)} · library receiver{n_sites(r)}{stale(r)}", r['display']))); continue
        rows.append((cert, ev(site(code, r['at'], f"{TAG.get(cert, cert)}{n_sites(r)}{stale(r)}", r['display']), r)))
    # a mapper method's own statement (its namespace and id bind it, ax_nonsource.mapper_elements) is the method's SQL:
    # a dependent, listed with the direct rows, not a [text] lead after every test
    for r in d.get('external', []):
        if r.get('how') == 'is its mapper statement':
            rows.append(('by key', site(code, r['at'], f"by key · its mapper statement{stale(r)}")))
    tests = {t['id'] for t in d.get('tests', [])}
    # a module's top level reaches it too, but its row is the file's first line (an import), which says nothing: those
    # come after the tests, so a cap spends its lines on callables and on what to run
    modules = []
    for r in d.get('reached', []):
        if r['id'] in seen or r['id'] in tests: continue
        mod = '<module>' in (r.get('display') or '')
        row = ('module' if mod else 'reached', site(code, r['at'], f"hop {r['hops']}" + (' · module scope' if mod else '') +
                                                     (' · test' if r.get('test') else '') + stale(r), r['display']))
        (modules if mod else rows).append(row)
    # a test file that loads the changed file before one that never imports it (impact's loads_change)
    far_files = {f for f in {(t.get('at') or '').rpartition(':')[0] for t in d.get('tests', [])}
                 if all(t.get('loads_change') is False for t in d.get('tests', []) if (t.get('at') or '').rpartition(':')[0] == f)}
    near_some = any(t.get('loads_change') is not False for t in d.get('tests', []))
    for r, k in sorted(per_test_file(d.get('tests', [])), key=lambda rk: near_some and rk[0]['at'].rpartition(':')[0] in far_files):
        far = ' · further out: never imports the change' if near_some and r['at'].rpartition(':')[0] in far_files else ''
        rows.append(('test', site(code, r['at'], f"test · {TAG.get(r.get('certainty'), r.get('certainty'))} · hop {r['hops']}" + far + more_in_file(k) + stale(r), r['display'])))
    for r in d.get('stub_tests', []):
        rows.append(('stub', site(code, r['at'], f"test · stubs it{stale(r)}", r['display'])))
    # a test file's top level is already its test row above
    listed = {(r.get('at') or '').rpartition(':')[0] for r in d.get('tests', [])}
    rows += [m for m in modules if m[1].split(':', 1)[0] not in listed]
    # a name written in a non-source file is a lead, not a dependent: a few are listed, the rest counted. A common name
    # (`main`, `run`) is written in hundreds of CI files and fixtures, and listed in full they were the whole answer
    shown = 0
    for r in d.get('external', []):
        if r.get('how') == 'is its mapper statement': continue
        if r.get('prose'): more('plain-word mentions'); continue
        if shown >= TEXT_ROWS: more('[text]'); continue
        rows.append(('text', site(code, r['at'], f"text · {r.get('how') or 'names it'}{stale(r)}"))); shown += 1
    rows += libs
    foot = []
    nt = len(d.get('tests', []))
    if 'test_universe' in d: foot.append(f"tests: {nt} of {d['test_universe']} reach it" + ("; `axiomcode test-impact` runs them" if nt else ''))
    foot += ev_foot(d)
    foot.append(verified(d.get('verified'), d.get('checked_hops')))
    if d.get('unresolved_inside'): foot.append(f"bound: {d['unresolved_inside']} unresolved call(s) inside — a lower bound")
    return rows, rest, foot


# ── path ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
def path(d, code):
    rows = []
    for a in d.get('answers', []):
        hops, prev = a.get('hops', []), a.get('from', '')
        for i, h in enumerate(hops, 1):
            t = h.get('tier')
            cert = 'defines (not a call)' if not h.get('is_call', True) else ax_edges.direct_cert(t)
            at = h.get('call_at') or h.get('declared_at')
            # caller → callee on every hop: the line is in the caller, and a chain found from B back to A reads right
            rows.append(('hop', ev(site(code, at, f"{cert} · hop {i}/{len(hops)} {prev} → {h['to']}{stale(h)}"), h)))
            prev = h['to']
    for r in d.get('reached', []):
        rows.append(('reached', site(code, r['at'], f"hop {r['hops']}{stale(r)}", r['name'])))
    # `path '*' X`'s by-name group (#1421): the sites impact lists as [by name], after every resolved row
    for r in d.get('by_name', []):
        rows.append(('by name', site(code, r['at'], f"by name · receiver not typed{stale(r)}", r['name'])))
    # every printed hop of a chain is looked up again (`unverified_hops` counts the ones that were not there); the
    # document's own `verified` speaks for the `'*'` closure
    ans = d.get('answers', [])
    v = d.get('verified')
    if ans: v = all(not a.get('unverified_hops') for a in ans) and v is not False
    foot = ev_foot(d) + [verified(v, sum(len(a.get('hops', [])) for a in ans) if ans else None)]
    if d.get('bound'): foot.append(f"bound: {d['bound']}")
    # what reaches a [by name] caller reaches the target too whenever the by-name site is real: counted, or the
    # upstream closure reads complete while every chain behind a by-name row is missing from it
    bb = d.get('by_name_behind')
    if bb:
        foot.append(f"bound: {bb['methods']} more method(s) in {bb['files']} file(s) reach a [by name] caller above through"
                    " the graph's edges — callers of the target too if that by-name site is real; nearest: "
                    + ', '.join(f"{x['name']} ({x['at']})" for x in bb.get('nearest', [])))
    return rows, {}, foot


# ── context ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def context(d, code):
    rows = []
    listed = set()
    # first: where a name the task writes is called though nothing declares it — the code to write is used there
    for u in d.get('called_undeclared', []):
        rows.append(('called', site(code, u['at'], f"calls {u['name']}, declared nowhere" + (f" · in {u['in']}" if u.get('in') else '')))); listed.add(u['at'])
    for s in d.get('flow', []):
        if s.get('repeat_of'): continue
        c = s.get('certainty') or 'entry'
        tag = f"step {s['step']} · {'entry' if c == 'entry' else TAG.get(c, c)}"
        if s.get('called_at_line'): tag += f" · called at L{s['called_at_line']}"
        if s.get('unresolved'): tag += ' · ⚠ ' + ', '.join(s['unresolved'][:2])
        rows.append(('flow', ev(site(code, s['at'], tag + stale(s), s['name']), s))); listed.add(s['at'])
    if not d.get('flow'):
        for e in d.get('entry_points', []):
            if e['at'] in listed: continue
            rows.append(('entry', site(code, e['at'], f"entry · {e.get('why', '')}".rstrip(' ·') + stale(e), e['name']))); listed.add(e['at'])
    for f in d.get('files', []):
        for nm, at in zip(f.get('declarations', []), f.get('declared_at') or []):
            if not at or at in listed: continue
            rows.append(('file', site(code, at, f"{f['how']} · {f.get('task_terms_matched', 0)} task term(s){stale(f)}", nm))); listed.add(at)
    tb = d.get('text_bindings', [])
    for t in tb[:TEXT_ROWS]:
        rows.append(('text', site(code, f"{t['file']}:{t['line']}", 'text · names ' + (t.get('name') or ', '.join(t.get('terms', []))) + stale(t))))
    foot = ev_foot(d)
    if d.get('not_indexed'): foot.append('not indexed: ' + ', '.join(map(str, d['not_indexed'][:3])))
    foot.append("bound: follows call edges and names; a constant, config key, string or reflection does not appear")
    return rows, ({'[text]': len(tb) - TEXT_ROWS} if len(tb) > TEXT_ROWS else {}), foot


def landing(d):
    """how much of the task a language's graph answers for: the most task words one of its files or entry points matches"""
    best = max([f.get('task_terms_matched', 0) for f in d.get('files', [])] + [0])
    for e in d.get('entry_points', []):
        best = max(best, len(re.findall(r"'[^']+'", e.get('why', ''))))
    return best


# ── test-impact ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_impact(d, code):
    rows = []
    for f in d.get('edited_test_files', []):
        rows.append(('test', f"{f}:1: (edited test file)  [test · edited]"))
    # the tests that load the changed file first; a file further out (it never imports the change, or reaches it only
    # many hops away) after them, said so
    further = set(d.get('further_test_files') or [])
    for t, k in per_test_file(d.get('tests', [])):
        far = (' · further out: never imports the change' if t.get('loads_change') is False else ' · further out') \
            if (t.get('at') or '').rpartition(':')[0] in further else ''
        rows.append(('test', ev(site(code, t['at'], f"test · {TAG.get(t.get('certainty'), t.get('certainty'))} · hop {t['hops']}{far}{more_in_file(k)}{stale(t)}", t['display']), t)))
    # a changed file no graph follows (a script, a fixture) is run by the test files that name it in their text
    names = {}
    for f, v in (d.get('named_in_test_text') or {}).items():
        for t in (v or {}).get('tests', []):
            names.setdefault(t, []).append((v or {}).get('needle') or f)
    for t, ns in names.items():
        rows.append(('text test', f"{t}:1: (names {', '.join(dict.fromkeys(ns))})  [test · text]"))
    foot = ev_foot(d)
    if d.get('command'): foot.append(f"run: {d['command']}")
    if d.get('command_further'): foot.append(f"run: (then, further out) {d['command_further']}")
    if d.get('bound'): foot.append(f"bound: {d['bound']}")
    return rows, {}, foot


def verified(v, hops=None):
    if v is True: return "verified: ✓" + (f" ({hops} edge(s) looked up again)" if hops else '')
    if v is False: return "verified: ✗ — an edge in this answer is not in the graph; do not use it"
    return "verified: nothing to check"


# how the rows left out past --grep-limit are counted, by the kind each verb gave them
KIND_WORD = {'contract': 'must change', 'reached': 'hop N', 'module': 'module scope', 'stub': 'stubs it', 'flow': 'step', 'file': 'declaration',
             'test': 'test file'}
VERBS = {'impact': impact, 'path': path, 'context': context, 'test-impact': test_impact, 'tests': test_impact}


def render(verb, doc, repo, cap=CAP):
    """the lines of the grep-shaped answer for a verb's --json document (and every other language's in it)"""
    code = Code(repo)
    docs = [(doc.get('language') or '', doc)] + list((doc.get('other_languages') or {}).items())
    left_out = []
    if verb == 'context' and len(docs) > 1:
        # a task is about one language's code far more often than about all of them: the graphs its words land in
        # best come first, and one where half as many words land or fewer is named, not listed
        docs.sort(key=lambda ld: -landing(ld[1]))
        best = landing(docs[0][1])
        if best > 0:
            left_out = [l for l, x in docs if 2 * landing(x) <= best]
            docs = [(l, x) for l, x in docs if 2 * landing(x) > best]
    rows, rest, foot = [], {}, []
    for lang, d in docs:
        if not isinstance(d, dict): continue
        r, m, f = VERBS[verb](d, code)
        rows += r
        for k, n in m.items(): rest[k] = rest.get(k, 0) + n
        foot += [x for x in f if x not in foot]
    out = [x for _k, x in rows[:cap]]
    if len(rows) > cap:
        kinds = {}
        for k, _x in rows[cap:]:
            k = KIND_WORD.get(k, k); kinds[k] = kinds.get(k, 0) + 1
        rest = dict(list({f'[{k}]': n for k, n in sorted(kinds.items(), key=lambda kv: -kv[1])}.items()) + list(rest.items()))
    if rest:
        how = ("limit=N lists more, full=True gives the whole answer" if os.environ.get('AXIOMCODE_SURFACE') == 'mcp' else
               "--grep-limit N lists more, the verb without --grep gives the whole answer")
        out.append(f"… +{sum(rest.values())} more not listed: " + ', '.join(f"{n} {k}" for k, n in rest.items()) + f" — {how}")
    if not rows: return None
    if left_out: out.append(f"also answered in the {', '.join(left_out)} graph(s), where fewer of the task's words land; --lang <language> asks one")
    return out + foot


def main(argv):
    verb, repo = argv[0], argv[1]
    cap = CAP
    rest = argv[2:]
    if rest and rest[0] == '--limit': cap = int(rest[1]); rest = rest[2:]
    cmd = rest[1:] if rest and rest[0] == '--' else rest
    import ax_exec
    r = subprocess.run(ax_exec.program(cmd + ['--json']), stdout=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
    try: doc = json.loads(r.stdout)
    except ValueError: doc = None
    if not isinstance(doc, dict) or r.returncode:
        # a refusal, as the verb said it: its prose when the document carries it ("no chain connects…"), else its text
        if isinstance(doc, dict) and isinstance(doc.get('prose'), list): print('\n'.join(doc['prose']))
        else: sys.stdout.write(r.stdout)
        return r.returncode
    lines = render(verb, doc, repo, cap)
    if lines is None:
        # no site at all ("no chain", nothing depends on it): the WHY is the answer, and only the prose says it
        if isinstance(doc.get('prose'), list): print('\n'.join(doc['prose']))
        else: return subprocess.run(ax_exec.program(cmd)).returncode
        return r.returncode
    print('\n'.join(lines))
    return r.returncode


if __name__ == '__main__':
    if len(sys.argv) < 4: sys.exit(__doc__)
    sys.exit(main(sys.argv[1:]))
