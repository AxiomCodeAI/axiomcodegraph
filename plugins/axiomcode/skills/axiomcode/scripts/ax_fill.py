#!/usr/bin/env python3
"""ax_fill.py — the whole graph's unresolved call sites as a worklist, and a batch of decisions on them.

An answer lists the unresolved sites it stopped at (ax_links.unknown_sites); nothing listed them all. The engine has done
what it can by the end of a build, so what is left is for an agent who reads the code:

    axiomcode unresolved [--limit N] [--json]     the summary, then the next N open sites, the ones on the most
                                                  walked callers first, each with its code, the engine's reason and
                                                  the graph's candidates
    axiomcode unresolved --summary                the one-line summary only
    axiomcode link --batch <file|->               decisions, one per line: `<file:line:col> <target>` links,
                                                  `<site> not:<target>` rejects a lead, `<site> ?` leaves it open

A SITE IS OPEN when the graph holds no edge for it, no link settles it, and it was not left open by an earlier pass on
the same line text. A `?` is kept in .axiomcode/fill-skipped.tsv: derived, like everything under .axiomcode, so losing
it only asks again; a skip whose line was edited is asked again. Links go through ax_links, validated and applied the
same way as one `link` at a time, with one apply for the whole batch.
"""
import json, os, re, sqlite3, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ax_links

SKIP_FILE = os.path.join('.axiomcode', 'fill-skipped.tsv')
SKIP_HEADER = '# axiomcode fill: unresolved sites an agent read and left open (`?`). Derived; deleting it only asks again. file line line_sha by at'


# ── the sites an earlier pass left open ──────────────────────────────────────────────────────────────────────────
def skip_path(repo):
    return os.path.join(repo, SKIP_FILE)


def read_skips(repo):
    """{(file, line): line_sha}"""
    out = {}
    try:
        with open(skip_path(repo), encoding='utf-8', errors='replace') as fh:
            for raw in fh.read().split('\n'):
                if not raw.strip() or raw.startswith('#'): continue
                p = raw.split('\t')
                if len(p) >= 3 and p[1].isdigit(): out[(p[0], int(p[1]))] = p[2]
    except OSError: pass
    return out


def write_skips(repo, skips, by='agent'):
    p = skip_path(repo)
    if not os.path.isdir(os.path.dirname(p)): return
    tmp = f"{p}.{os.getpid()}.tmp"; at = time.strftime('%Y-%m-%dT%H:%M:%S')
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(SKIP_HEADER + '\n')
        for (f, l), sha in sorted(skips.items()): fh.write(f"{f}\t{l}\t{sha}\t{by}\t{at}\n")
    os.replace(tmp, p)


def skipped(skips, reader, f, line):
    sha = skips.get((f, line))
    if not sha: return False
    L = reader.lines(f)
    return bool(L) and 0 < line <= len(L) and ax_links.line_sha(L[line - 1]) == sha


# ── one graph's open sites ───────────────────────────────────────────────────────────────────────────────────────
def _site_file(con):
    try: m = {r[0]: r[1] for r in con.execute("SELECT raw, rel FROM paths")}
    except sqlite3.Error: m = {}
    return lambda raw: m.get(raw, raw)


def _tables(con):
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}


def graph_counts(con):
    """{calls, project, boundary, asserted} of one graph: every call site; those with an engine edge into the project's
    own code; those whose engine edges all stop at a library or builtin; those a link settled"""
    t = _tables(con)
    if not all(x in t for x in ('call_sites', 'call_edges')): return dict(calls=0, project=0, boundary=0, asserted=0)
    one = lambda sql: (con.execute(sql).fetchone() or [0])[0]
    return dict(
        calls=one("SELECT COUNT(*) FROM call_sites"),
        project=one("SELECT COUNT(DISTINCT call_site_id) FROM call_edges WHERE tier <> 'asserted' AND callee_provenance = 'client'"),
        boundary=one("SELECT COUNT(DISTINCT e.call_site_id) FROM call_edges e WHERE e.tier <> 'asserted' AND NOT EXISTS (SELECT 1 FROM call_edges x "
                     "WHERE x.call_site_id = e.call_site_id AND x.tier <> 'asserted' AND x.callee_provenance = 'client')"),
        asserted=one("SELECT COUNT(DISTINCT call_site_id) FROM call_edges WHERE tier = 'asserted'"))


def _project_names(con):
    """(every callable name the project declares, the names of its METHODS): a call on a receiver reaches a method,
    never a free or nested function"""
    try:
        rows = con.execute("SELECT DISTINCT name, kind FROM symbols WHERE method_id IS NOT NULL AND kind <> 'module'").fetchall()
    except sqlite3.Error: return set(), set()
    return {n for n, _k in rows}, {n for n, k in rows if k in ('method', 'constructor', 'field')}


# a call written as a bare name or a computed callee: when the name declares nothing, it is a parameter, a local or a
# computed value, so the target may be anywhere
BARE_VALUE_KINDS = {'SIMPLE_CALL', 'DYNAMIC_CALL', 'COMPUTED_CALL', 'FUNCTION_CALL_APPLY', 'FUNCTION_CALL_CALL',
                    'FUNCTION_CALL_BIND', 'IIFE_CALL', 'DYNAMIC_CODE_CALL'}


_JS_IMPORT = re.compile(r'^\s*import\s+(?:type\s+)?([^;]*?)\s+from\s+[\'"]([^\'"]+)[\'"]')


def imported_names(lines):
    """the names a file binds by importing them from a PACKAGE: Python `from x import a, b as c` / `import a`, and a JS/TS
    import from a bare specifier (a relative one is the project's own, which declares the name anyway)"""
    out = set()
    for t in lines or []:
        st = t.split('#')[0].strip()
        if st.startswith('from ') and ' import ' in st and not st.rstrip(';').endswith(("'", '"')):     # Python from-import
            if st.split()[1].startswith('.'): continue                                                  # the project's own
            for part in st.split(' import ', 1)[1].strip('() ').split(','):
                part = part.strip().strip('()')
                if part and part != '*': out.add(part.split(' as ')[-1].strip())
            continue
        if st.startswith('import ') and not any(q in st for q in ('"', "'")):                             # Python import
            for part in st[len('import '):].split(','):
                part = part.strip()
                if part: out.add(part.split(' as ')[-1].strip().split('.')[0])
            continue
        m = _JS_IMPORT.match(t)
        if m and not m.group(2).startswith('.'):
            for part in re.split(r'[{},]', m.group(1)):
                part = part.strip()
                if part and part != '*': out.add(part.split(' as ')[-1].strip())
    return out


def fillable(names, reader=None, site_file=lambda f: f):
    """keep(row, reason) for unknown_sites: a site whose target may be the project's own code. A call through a VALUE
    (a bare name that is a parameter or a local, a computed or reflective call, a value a library runs) may land
    anywhere; a member call lands in the project only when some project declaration carries the name called. The rest,
    a library's method on a receiver the engine could not type (`text.strip()`, `path.exists()`), is not linked by
    reading the project: --library stages the library so the engine resolves it."""
    every, members = names
    seen = {}
    def imported(f):
        if f not in seen: seen[f] = imported_names(reader.lines(site_file(f)) if reader else None)
        return seen[f]
    def keep(row, reason):
        _sid, _c, kind, callee, _f, _l = row
        nm = (callee or '').split('.')[-1]
        on_receiver = kind in ax_links.MEMBER_KINDS or reason.startswith('untyped_receiver') or '.' in (callee or '')
        if nm in (members if on_receiver else every): return True
        # no project declaration carries the name: only a call THROUGH A VALUE may still land in the project. A member
        # called on a receiver the engine could not type (`s[:1].isupper()` is a SUBSCRIPT_CALL, `p.exists()` can be an
        # UNKNOWN_CALLEE_CALL), or a library's decorator, is the library's
        if reason.startswith('untyped_receiver'): return False
        if reason.startswith('runs a value through '): return True     # process launchers are already left out (ax_links)
        if reason in ax_links.VALUE_REASONS or reason == 'escape_hatch': return True
        # a bare name the project does not declare: a parameter or a local holding a function — unless the file imports
        # it, which makes it a library's function (`from html import escape`)
        return kind in BARE_VALUE_KINDS and '.' not in (callee or '') and nm not in imported(_f)
    return keep


def _leads(site, names):
    """a member call's candidates are the declarations of its name; any other candidate is not a lead for it"""
    if site['kind'] in ax_links.MEMBER_KINDS or str(site.get('reason', '')).startswith('untyped_receiver'):
        nm = site['call'].split('.')[-1]
        site['candidates'] = [c for c in site.get('candidates') or [] if c['target'].split('.')[-1] == nm]
    return site


def open_sites(con, repo, reader, skips, every=False, cands=True):
    """([site dict] of one graph, unresolved, library-only): every unresolved site that may land in the project, with
    no link settling it and no skip covering it, the sites inside the most called callers first (a gap in a hub breaks
    every chain through it). every=True keeps the library-only sites too."""
    t = _tables(con)
    if 'unresolved_sites' not in t: return [], 0, 0, 0
    q = lambda sql, *a: con.execute(sql, a).fetchall()
    fan = dict(q("SELECT s.id, COUNT(e.call_site_id) FROM symbols s JOIN call_edges e ON e.callee_method_id = s.method_id "
                 "WHERE s.id IN (SELECT DISTINCT caller_id FROM unresolved_sites) GROUP BY s.id"))
    callers = [r[0] for r in q("SELECT DISTINCT caller_id FROM unresolved_sites")]
    order = sorted(callers, key=lambda c: (-fan.get(c, 0), str(c)))
    names = _project_names(con)
    _all, n_all = ax_links.unknown_sites(q, callers, _site_file(con), limit=0, order=order, repo=repo)
    sites, n_proj = ax_links.unknown_sites(q, callers, _site_file(con), limit=10 ** 9, order=order, repo=repo,
                                           keep=fillable(names, reader, _site_file(con)), with_candidates=cands and not every)
    def still_open(rows):
        out = []
        for s in rows:
            if s['linked']: continue
            f, _, ln = s['at'].rpartition(':')
            if skipped(skips, reader, f, int(ln or 0)): continue
            out.append(_leads(s, names))
        return out
    proj = still_open(sites)
    # the listing may take every site (--all); the counts stay the project/library split
    listing = still_open(ax_links.unknown_sites(q, callers, _site_file(con), limit=10 ** 9, order=order, repo=repo,
                                                with_candidates=cands)[0]) if every else proj
    return listing, n_all, n_all - n_proj, len(proj)


def worklist(repo, limit=25, every=False):
    """(summary dict, [open site]) over every live graph of the repository; limit 0 counts only (no candidates)"""
    cands = limit > 0
    # the links file may have changed since the graphs were last given it (edited, pulled, deleted): as before a query
    try: ax_links.sync(repo)
    except Exception: pass
    reader = ax_links.Reader(repo); skips = read_skips(repo)
    summ = dict(calls=0, project=0, boundary=0, asserted=0, unresolved=0, library=0, open=0, skipped=0, graphs=0)
    sites = []
    for db, _rd, live in ax_links.graph_dbs(repo):
        if not live: continue
        try: con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        except sqlite3.Error: continue
        try:
            for k, v in graph_counts(con).items(): summ[k] += v
            got, n_all, n_lib, n_open = open_sites(con, repo, reader, skips, every, cands)
            summ['graphs'] += 1; summ['unresolved'] += n_all; summ['library'] += n_lib; summ['open'] += n_open
            sites += got
        except sqlite3.Error: pass
        finally: con.close()
    summ['skipped'] = sum(1 for (f, l) in skips if skipped(skips, reader, f, l))
    return summ, sites[:limit]


def mcp_surface():
    return os.environ.get('AXIOMCODE_SURFACE') == 'mcp'


def fill_verb():
    """how this surface starts a fill pass: the MCP tools name no flags (the server drops a clause naming one)"""
    return 'unresolved(), then unresolved(decisions=...)' if mcp_surface() else '/axiomcode:fill (shell: axiomcode unresolved)'


def summary_line(s, verb=None):
    """one line: what the graph resolved, and what is left for someone who reads the code"""
    verb = verb or fill_verb()
    if not s['graphs']: return ''
    left = s['unresolved'] - s['library']
    tail = (f" — {s['open']} open: link them with {verb}" if s['open'] else ' — none open')
    return (f"graph: {s['calls']} call sites · {s['project']} resolved into the project · {s['boundary']} into a library · "
            f"{s['asserted']} asserted by a link · {s['unresolved']} unresolved: {left} may land in the project "
            f"({s['skipped']} left open by a fill pass), {s['library']} a library's method on an untyped value{tail}")


def print_worklist(repo, limit, as_json, every=False):
    s, sites = worklist(repo, limit, every)
    if as_json:
        print(json.dumps(dict(summary=s, sites=sites), indent=1)); return 0
    print(summary_line(s))
    if not sites: return 0
    print(f"next {len(sites)} open site(s)" + (' (library ones included)' if every else f" of {s['open']}") + ", the most called callers first:")
    for x in sites:
        code = ax_links.code_at(repo, x['at'])
        print(f"  {x['site']}  {code[:100]}")
        print(f"      in {x['caller']} · calls `{x['call']}` · {x['reason']}")
        cs = x.get('candidates') or []
        print("      candidates: " + ('; '.join(f"{c['target']} {c['at']} ({c['why']})" for c in cs[:4]) if cs else 'none in the graph'))
    how = 'unresolved(decisions="<one per line>"), which answers with the next page' if mcp_surface() else '`axiomcode link --batch -` (decisions on stdin)'
    print("decide each from the code, one line per site: `<site> <target>` when the code makes it CERTAIN, `<site> not:<target>` "
          f"for a wrong candidate, `<site> ?` to leave it open; send them with {how}. A candidate is a lead: never link one for its rank.")
    return 0


# ── a batch of decisions ─────────────────────────────────────────────────────────────────────────────────────────
def parse_batch(text):
    """[(site, target)] from `<site> <target>` lines (tab or spaces); comments and blanks skipped"""
    out, bad = [], []
    for n, raw in enumerate((text or '').split('\n'), 1):
        s = raw.strip()
        if not s or s.startswith('#'): continue
        p = s.split(None, 1)
        if len(p) != 2: bad.append((n, s, 'expected `<file:line[:col]> <target | not:target | ?>`')); continue
        out.append((p[0], p[1].strip()))
    return out, bad


def run_batch(repo, text, as_json=False):
    """apply a batch: skips are recorded, links and rejections validated one by one (ax_links.validate) and written
    together, then applied once. -> exit code (0 when every decision was taken)"""
    pairs, bad = parse_batch(text)
    reader = ax_links.Reader(repo)
    skips = read_skips(repo)
    links, malformed = ax_links.read_links(repo)
    res = [dict(line=n, site=s, target='', status='malformed', reason=why) for n, s, why in bad]
    nskip = 0
    for site, target in pairs:
        f, line, col = ax_links.site_arg(repo, site)
        if f is None:
            res.append(dict(site=site, target=target, status='malformed', reason='the site is written file:line[:col]')); continue
        if target == '?':
            L = reader.lines(f)
            if not L or not (0 < line <= len(L)):
                res.append(dict(site=site, target='?', status='rejected', reason='not a line of a file in this repository')); continue
            skips[(f, line)] = ax_links.line_sha(L[line - 1]); nskip += 1
            res.append(dict(site=site, target='?', status='left open', reason='')); continue
        ok, why, links = ax_links.validate(repo, links, f, line, col, target, reader)
        if ok and target.startswith('not:'):
            # the agent read the site and rejected a lead: unless it links a target too, nothing certain is left there
            # this pass, so it is not asked again until its line changes
            L = reader.lines(f); skips[(f, line)] = ax_links.line_sha(L[line - 1]); nskip += 1
        res.append(dict(site=site, target=target, status='linked' if ok and not target.startswith('not:') else ('rejected lead' if ok else 'refused'), reason=why))
    for r in res:
        if r['status'] == 'linked':
            f, line, _c = ax_links.site_arg(repo, r['site']); skips.pop((f, line), None); nskip += 1
    if nskip: write_skips(repo, skips, os.environ.get('AXIOMCODE_LINK_BY') or 'agent')
    t0 = time.time()
    if any(r['status'] in ('linked', 'rejected lead') for r in res):
        ax_links.write_links(repo, links); ax_links._restore_bad(repo, malformed)
        ax_links.apply_repo(repo)
    ms = (time.time() - t0) * 1000
    s, _ = worklist(repo, 0)
    if as_json:
        print(json.dumps(dict(results=res, summary=s, apply_ms=round(ms)), indent=1))
    else:
        cnt = {}
        for r in res: cnt[r['status']] = cnt.get(r['status'], 0) + 1
        print(f"batch: {', '.join(f'{n} {k}' for k, n in sorted(cnt.items())) or 'nothing'} — applied in {ms:.0f} ms")
        for r in res:
            if r['status'] in ('refused', 'malformed', 'rejected'): print(f"  {r['status']}: {r['site']} → {r['target']} — {r['reason']}")
        print(summary_line(s))
    return 0 if all(r['status'] in ('linked', 'rejected lead', 'left open') for r in res) else 1


# ── telling the agent, once per build ───────────────────────────────────────────────────────────────────────────
def build_stamp(repo):
    """what identifies the graphs a repository has now: each live graph's file and modification time"""
    parts = []
    for db, _r, live in ax_links.graph_dbs(repo):
        if not live: continue
        try: st = os.stat(db); parts.append(f"{os.path.realpath(db)}@{int(st.st_mtime)}")
        except OSError: pass
    return '|'.join(parts)


def notice(repo, surface):
    """the line that starts a fill pass, ONCE per build per surface ('hook', 'mcp'), and only when sites are open;
    '' otherwise. A build the agent already heard about stays quiet whatever is left in it."""
    stamp = build_stamp(repo)
    if not stamp: return ''
    mark = os.path.join(repo, '.axiomcode', f'.fill-noted-{surface}')
    try:
        with open(mark, encoding='utf-8') as fh:
            if fh.read().strip() == stamp: return ''
    except OSError: pass
    s, _ = worklist(repo, 0)
    try:
        with open(mark, 'w', encoding='utf-8') as fh: fh.write(stamp)
    except OSError: pass
    if not s['open']: return ''
    how = ('call unresolved(), and settle each page with unresolved(decisions=...)' if surface == 'mcp'
           else 'run /axiomcode:fill (it reads them in a subagent and links only what the code makes certain)')
    return (f"graph: the engine left {s['open']} call site(s) unresolved that may land in this project's own code — "
            f"answers stop there. To fill them: {how}. "
            f"({s['library']} more are a library's method on an untyped value; those are not linked by reading.)")


def main(argv):
    as_json = '--json' in argv; argv = [a for a in argv if a != '--json']
    limit = 25
    if '--limit' in argv:
        i = argv.index('--limit')
        try: limit = max(0, int(argv[i + 1]))
        except (IndexError, ValueError): print("axiomcode unresolved: --limit takes a number", file=sys.stderr); return 2
        del argv[i:i + 2]
    if '--notice' in argv:
        i = argv.index('--notice'); surface = argv[i + 1] if i + 1 < len(argv) else 'hook'; del argv[i:i + 2]
        repo, _ = ax_links.find_repo(argv)
        line = notice(repo, surface) if os.path.isdir(os.path.join(repo, '.axiomcode')) else ''
        if line: print(line)
        return 0
    only = '--summary' in argv; argv = [a for a in argv if a != '--summary']
    every = '--all' in argv; argv = [a for a in argv if a != '--all']
    repo, _ = ax_links.find_repo(argv)
    if not os.path.isdir(os.path.join(repo, '.axiomcode')):
        print(f"axiomcode unresolved: no graph for {repo} — `axiomcode index` builds it", file=sys.stderr); return 2
    if only:
        s, _ = worklist(repo, 0)
        print(json.dumps(s) if as_json else summary_line(s)); return 0
    return print_worklist(repo, limit, as_json, every)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
