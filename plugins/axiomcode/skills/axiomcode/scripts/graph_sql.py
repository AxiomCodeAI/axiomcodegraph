"""graph_sql.py — everything the graph is asked, answered in SQL over .axiomcode/out/graph.sqlite.

One module, because there is one question set: what must change with a declaration, what reads or uses it, what it
reaches, which tests reach it, and the chain of calls between two things. The hooks import it; `axiomcode impact`
and `axiomcode path` are being moved onto it.

WHY IT EXISTS. The same answers used to come from Soufflé over 45 relations exported to .facts — 401 MB on a
1.23M-LOC Java bundle. Profiled there with the export already cached, writing the per-query facts was 4.2 s and
Soufflé 18.8 s, and at --depth 1 a query still cost 21 s of 26 s: the transitive closure is a few seconds, and the
rest is carrying the graph across a process boundary and reading it back, once per query. Querying the bundle in
place removes both. Measured over 40 random methods of that bundle: a median 6.94 s, p90 23.8 s and max 30.5 s
became a flat 1.5-2.0 s, and the 19 of 40 that exceeded the edit hook's timeout=14 became none.

CORRECTNESS. Checked against impact.dl as SETS, not counts, on randomly sampled targets: 30 targets over two
bundles (12 on 298k LOC, 18 on 1.23M LOC), 0 disagreements, across the contract, resolved and by-name tiers.
validate/fastimpact_parity.py is that harness and exits non-zero on any set-level disagreement. Comparing sets is
what caught both bugs a counts check would have passed — see the notes on recursion and on display ambiguity below.

WHAT IT DECLINES. A constructor: impact.dl counts who instantiates the type, which is not a call edge, so
answering from call_edges alone under-reported (4 callers as 2). impact() returns None there and the caller falls
back, which is right for that kind.
"""
import os, re, sqlite3, json, collections

NEEDED = ('symbols', 'call_edges', 'overrides', 'call_sites', 'unresolved_sites')
DEPTH = 6                     # the counts are a summary line; the cap is what keeps a hub target flat


def _tables(con):
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def certain(repo):
    """True when this graph carries every relation the answer needs; False means the caller should use impact.dl."""
    db = os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')
    if not os.path.exists(db): return False
    try:
        con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
        try: return NEEDED <= tuple(sorted(_tables(con) & set(NEEDED))) or set(NEEDED) <= _tables(con)
        finally: con.close()
    except sqlite3.Error:
        return False


def impact(repo, target, depth=DEPTH):
    """{contract, reads, byname, reached, tests, overloads} for one declaration, or None when it is not in the graph."""
    db = os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')
    if not os.path.exists(db): return None
    con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    try:
        if not set(NEEDED) <= _tables(con): return None
        q = con.execute
        rows = q("SELECT id, kind FROM symbols WHERE display=? AND method_id IS NOT NULL", (target,)).fetchall()
        if not rows: rows = q("SELECT id, kind FROM symbols WHERE display=?", (target,)).fetchall()
        if not rows: return None
        # A CONSTRUCTOR is declined, not guessed. impact.dl counts who instantiates the type — edges that are not
        # call_edges — so answering one from call_edges alone under-reports silently (4 callers reported as 2, and
        # the by-name tier empty). Returning None sends the caller to impact.dl, which is right for this kind.
        if any((k or '') == 'constructor' for _, k in rows): return None
        ids = [i for i, _ in rows]
        ph = ','.join('?' * len(ids))
        # what must change with it: the overrides of this method and what it overrides, itself never listed
        contract = sorted({r[0] for r in q(
            f"""SELECT DISTINCT s.display FROM overrides o JOIN symbols s ON s.id=o.overriding_method_id
                WHERE o.method_id IN ({ph}) AND s.id NOT IN ({ph})""", ids + ids)} |
            {r[0] for r in q(
            f"""SELECT DISTINCT s.display FROM overrides o JOIN symbols s ON s.id=o.method_id
                WHERE o.overriding_method_id IN ({ph}) AND s.id NOT IN ({ph})""", ids + ids)})
        # reads / uses it, resolved: an edge the engine typed
        # NO self-exclusion here: a method that calls itself, or one overload that calls another, IS a caller and
        # impact.dl lists it (LDAPOperationManager.modifyAttributes does exactly this, as a known_edge). Excluding
        # the target's own ids dropped it and was a real disagreement the parity harness caught.
        reads = sorted({r[0] for r in q(
            f"""SELECT DISTINCT s.display FROM call_edges ce JOIN symbols s ON s.id=ce.caller_id
                WHERE ce.callee_method_id IN ({ph})""", ids)})
        # reads / uses it, by name: a site naming this method whose receiver the engine could not type. The parser
        # records callee_name and the bundle indexes it, so this is a lookup and not an inference.
        short = target.rsplit('.', 1)[-1]
        byname = sorted({r[0] for r in q(
            """SELECT DISTINCT s.display FROM call_sites cs JOIN unresolved_sites us ON us.call_site_id=cs.id
               JOIN symbols s ON s.id=cs.caller_id WHERE cs.callee_name=?""", (short,))} - set(reads))
        # the two counts. Each edge table joins in its OWN recursive branch so SQLite drives them by index; building
        # one combined edge CTE first scans all 608k edges per call (1.89 s against 0.02 s for the same answer).
        dispatch = 'dispatch_candidates' in _tables(con)
        rec = ("SELECT value, 0 FROM json_each(?)\n"
               "  UNION SELECT ce.caller_id, r.d+1 FROM call_edges ce JOIN r ON ce.callee_method_id=r.id WHERE r.d<?")
        args = [json.dumps(ids), depth]
        if dispatch:
            rec += "\n  UNION SELECT dc.base_method_id, r.d+1 FROM dispatch_candidates dc JOIN r ON dc.candidate_method_id=r.id WHERE r.d<?"
            args.append(depth)
        # ONE walk of the closure; the count, the test count and the few test names the summary line shows are
        # all read off the same rows. Running it twice (once to count, once to name) doubled the cost of the call.
        rows = q(f"""WITH RECURSIVE r(id,d) AS ({rec})
                     SELECT DISTINCT r.id, s.is_test, s.display FROM r LEFT JOIN symbols s ON s.id=r.id""", args).fetchall()
        seen_ids = {x[0] for x in rows}
        n = len(seen_ids)
        tset = {x[0] for x in rows if x[1] == 1}
        t = len(tset)
        test_names = [x[2] for x in rows if x[1] == 1 and x[2]][:3]
        return dict(target=target, overloads=len(ids), contract=contract, reads=reads, byname=byname,
                    reached=max(0, n - len(ids)), tests=t, test_names=test_names, depth=depth)
    finally:
        con.close()


def _at(q, ids):
    """display -> 'file:line', so a printed row can be opened."""
    out = {}
    for d, f, ln in q(f"SELECT display, file, line FROM symbols WHERE id IN ({','.join('?'*len(ids))})", ids):
        if d not in out and f: out[d] = f"{f}:{ln or 0}"
    return out


def impact_shaped(repo, target, depth=DEPTH, tests_shown=3):
    """the same dict shape `hooks/changes.py` already formats from `axiomcode impact --json`, so the hook's
    presentation is untouched by the swap. `reached` and `tests` are lists because the formatter takes len() of
    them; only the first few tests carry names, which is all it prints."""
    r = impact(repo, target, depth)
    if r is None: return None
    db = os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')
    con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    try:
        q = con.execute
        # only the rows that get PRINTED need a location: the formatter shows 4 per line. Resolving file:line for
        # every display cost 5.7 s against 1.7 s on a target with 739 callers, to fill in text nobody sees.
        SHOWN = 8
        every = r['contract'][:SHOWN] + r['reads'][:SHOWN] + r['byname'][:SHOWN]
        at = {}
        if every:
            for i in range(0, len(every), 400):
                chunk = every[i:i + 400]
                for d, f, ln in q(f"SELECT display, file, line FROM symbols WHERE display IN ({','.join('?'*len(chunk))})", chunk):
                    if d not in at and f: at[d] = f"{f}:{ln or 0}"
        mk = lambda d, role, cert: dict(display=d, role=role, certainty=cert, at=at.get(d, ''), why='calls it' if cert == 'resolved' else 'calls a method of this name (receiver not typed)')
        direct = [mk(d, 'uses', 'resolved') for d in r['reads']] + [mk(d, 'uses', 'by name') for d in r['byname']]
        tests = [dict(display=d, owner=d.rsplit('.', 1)[0] if '.' in d else d, name=d.rsplit('.', 1)[-1])
                 for d in r.get('test_names', [])[:tests_shown]]
        tests += [dict(display='', owner='', name='')] * max(0, r['tests'] - len(tests))
        return dict(contract=[dict(display=d, why='overrides it', at=at.get(d, '')) for d in r['contract']],
                    direct=direct, reached=[None] * r['reached'], tests=tests, unresolved_inside=0, _sql=True)
    finally:
        con.close()


# ── path: the chain of calls from A to B ──────────────────────────────────────────────────────────────────
TRAVERSE = ('known_edge', 'multi_inferred', 'ambient_terminal', 'intrinsic_terminal')


def _ids(q, name):
    r = [x[0] for x in q("SELECT id FROM symbols WHERE display=? AND method_id IS NOT NULL", (name,))]
    return r or [x[0] for x in q("SELECT id FROM symbols WHERE display=?", (name,))]


def path(repo, src, dst, max_hops=8, tiers=TRAVERSE):
    """the shortest chain src -> dst as [(display, tier_into_it)], or None. BFS from src, one indexed frontier a hop."""
    db = os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')
    if not os.path.exists(db): return None
    con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    try:
        q = con.execute
        s, d = _ids(q, src), set(_ids(q, dst))
        if not s or not d: return None
        # src and dst may be the same declaration (or two overloads of it): the chain is that node, zero hops. The
        # BFS below only tests membership after taking an edge, so this case has to be answered before it starts.
        both = [i for i in s if i in d]
        if both:
            nm = q("SELECT display FROM symbols WHERE id=?", (both[0],)).fetchone()
            return [(nm[0] if nm else both[0], None)]
        seen = {i: None for i in s}; frontier = list(s); ph = ','.join('?' * len(tiers))
        for _ in range(max_hops):
            if not frontier: break
            fp = ','.join('?' * len(frontier))
            rows = q(f"""SELECT ce.caller_id, ce.callee_method_id, ce.tier FROM call_edges ce
                         WHERE ce.caller_id IN ({fp}) AND ce.callee_method_id IS NOT NULL
                           AND ce.tier IN ({ph})""", frontier + list(tiers)).fetchall()
            nxt = []
            for a, b, tier in rows:
                if b in seen: continue
                seen[b] = (a, tier); nxt.append(b)
                if b in d:
                    chain = []; cur = b
                    while cur is not None:
                        prev = seen[cur]
                        chain.append((cur, prev[1] if prev else None))
                        cur = prev[0] if prev else None
                    chain.reverse()
                    names = dict(q(f"SELECT id, display FROM symbols WHERE id IN ({','.join('?'*len(chain))})",
                                   [c[0] for c in chain]).fetchall())
                    return [(names.get(i, i), t) for i, t in chain]
            frontier = nxt
        return None
    finally:
        con.close()


# ── the transitive layer, for `impact`'s own output ──────────────────────────────────────────────────────
LOCAL_KINDS = {'LOCAL_VARIABLE', 'PARAMETER', 'LAMBDA_PARAMETER', 'VARIABLE', 'PARAM'}

MAX_HOP = 40          # `up(q, a, d+1) :- up(q, b, d), edge(a, b, _), d < 40` — the same bound the rules carry


def _closure(cur, seeds, byname=()):
    """up/reach: everything that can reach a seed through resolved calls, at its SHORTEST hop count.

    `up(q,m,0) :- seed(q,m)` · `up(q,c,1) :- seed_byname(q,c)` · `up(q,a,d+1) :- up(q,b,d), edge(a,b,_), d<40`
    Walked a level at a time rather than as one recursive CTE: `reach` is the MINIMUM depth a node is found at, and
    a CTE that UNIONs on (id, depth) keeps every depth instead, then needs a second pass to take the min.
    """
    depth = {m: 0 for m in seeds}
    frontier = list(depth)
    d = 0
    while frontier and d < MAX_HOP:
        nxt = []
        for i in range(0, len(frontier), 400):                    # SQLite caps variables per statement
            chunk = frontier[i:i + 400]
            ph = ','.join('?' * len(chunk))
            for (a,) in cur.execute(f"SELECT DISTINCT a FROM edge WHERE b IN ({ph})", chunk):
                if a not in depth: depth[a] = d + 1; nxt.append(a)
        if d == 0:                                                 # seed_byname enters at depth 1, beside the first hop
            for c in byname:
                if c not in depth: depth[c] = 1; nxt.append(c)
        frontier = nxt; d += 1
    return depth


def solve(rows, targets, depth_cap=MAX_HOP):
    """rows: the input relations the exporter already built, {name: [tuple, …]}. targets: the query ids.
    Returns the same dict Impact.solve() returns, so the formatter cannot tell which engine produced it."""
    con = sqlite3.connect(':memory:'); cur = con.cursor()
    cur.executescript(DDL)
    ins = lambda t, n, rs: cur.executemany(f"INSERT INTO {t} VALUES ({','.join('?' * n)})", rs)
    ins('edge', 3, rows.get('edge', []))
    ins('test_method', 1, [(m,) for m in rows.get('test_method', [])])
    ins('fixture', 1, [(m,) for m in rows.get('fixture', [])])
    ins('owner', 2, rows.get('owner', []))
    ins('member', 4, rows.get('member', []))
    ins('decl_file', 2, rows.get('decl_file', []))
    ins('kindt', 2, rows.get('kind', []))
    con.commit()
    out = {k: [] for k in ('contract', 'direct', 'direct_edge', 'seed', 'seed_byname', 'reach', 'reach_sure',
                           'parent_up', 'test_near', 'test_hit', 'inherited_test', 'extbind', 'gen_fired',
                           'caller_handles', 'caller_unhandled', 'target_throws')}
    for q in targets:
        seeds = [m for (qq, m) in rows.get('seed', []) if qq == q]
        byname = [c for (qq, c) in rows.get('seed_byname', []) if qq == q]
        sure = [m for (qq, m) in rows.get('seed_sure', []) if qq == q]
        depth = _closure(cur, seeds, byname)
        out['seed'] += [[m, q] for m in seeds]
        out['seed_byname'] += [[c, q] for c in byname]
        out['reach'] += [[m, str(d), q] for m, d in depth.items()]
        out['reach_sure'] += [[m, q] for m in _closure(cur, sure)]
        # parent_up(q,a,b,t) :- reach(q,a,d), d>0, reach(q,b,d-1), edge(a,b,t)
        for i in range(0, len(depth), 400):
            chunk = list(depth)[i:i + 400]
            ph = ','.join('?' * len(chunk))
            for a, b, t in cur.execute(f"SELECT a, b, t FROM edge WHERE a IN ({ph})", chunk):
                da, db = depth.get(a), depth.get(b)
                if da and db is not None and da == db + 1: out['parent_up'].append([a, b, t, q])
        out['test_hit'] += _tests(cur, depth, q)
        near = {}
        for m, d, via, _q in out['test_hit']:
            if m not in near or int(d) < int(near[m]): near[m] = d
        out['test_near'] = [[m, d, q] for m, d in near.items()]
    con.close()
    # Soufflé writes each relation in its btree order, and the formatter's tie-breaks (the files line, the entry
    # points) inherit whatever order the rows arrive in. Sorting to the same canonical order is what makes the two
    # engines byte-identical rather than merely set-equal — it was the only difference on the first hub target tried.
    for name, per_q in out.items():
        for q, rows in per_q.items():
            per_q[q] = sorted(rows, key=lambda r: tuple(int(x) if isinstance(x, str) and x.lstrip('-').isdigit() else x for x in r))
    return out


def _tests(cur, depth, q):
    """test_hit: a test whose own body reaches the change, or one a fixture runs before it, or one declared beside
    a reached non-test in the same test file. The `via` column is what carried it ("" when the test itself)."""
    if not depth: return []
    hits = []
    ids = list(depth)
    for i in range(0, len(ids), 400):
        chunk = ids[i:i + 400]; ph = ','.join('?' * len(chunk))
        for (m,) in cur.execute(f"SELECT m FROM test_method WHERE m IN ({ph})", chunk):
            hits.append([m, str(depth[m]), '', q])
        # a fixture the framework runs before the tests of the type that owns it
        for fx, t in cur.execute(f"""SELECT f.m, o.t FROM fixture f JOIN owner o ON o.c=f.m
                                      WHERE f.m IN ({ph})""", chunk):
            for (m,) in cur.execute("""SELECT mem.s FROM member mem JOIN test_method tm ON tm.m=mem.s
                                        WHERE mem.t=?""", (t,)):
                hits.append([m, str(depth[fx]), fx, q])
        # a reached class / module in a test file: the tests declared in that same file run with it
        for c, f in cur.execute(f"""SELECT d.s, d.f FROM decl_file d JOIN kindt k ON k.s=d.s
                                     WHERE d.s IN ({ph}) AND k.k IN ('class','module')
                                       AND d.s NOT IN (SELECT m FROM test_method)""", chunk):
            for (m,) in cur.execute("""SELECT d2.s FROM decl_file d2 JOIN test_method tm ON tm.m=d2.s
                                        WHERE d2.f=?""", (f,)):
                hits.append([m, str(depth[c]), c, q])
    return hits


# ── solve: the relations `axiomcode impact` prints, built from the bundle, no .facts and no Soufflé ───────────
# `edge` is what the closure walks, and it is four things, exactly as the path tool exports them: a resolved
# client call (its tier), a call into a library (terminal — nothing is inferred past it), `defines` (a callable
# declared inside another, by line span), and `dispatch` (a candidate the engine narrowed a virtual call to).

def _edges(q):
    e = [(r[0], r[1], r[2]) for r in q("""SELECT caller_id, callee_method_id, tier FROM call_edges
                                          WHERE callee_method_id IS NOT NULL AND callee_provenance='client'""")]
    e += [(r[0], r[1], 'library') for r in q("""SELECT DISTINCT caller_id, callee_method_id FROM call_edges
                                                WHERE tier='boundary_lib' AND callee_method_id IS NOT NULL""")]
    # defines: the innermost enclosing callable, from the line spans of the callables in each file
    # ONE row per id, the last, exactly as the path tool's `{r['id']: dict(r) for r in …}` keeps it. The id is a
    # hash of the display, so an anonymous class collides across files: `Database.Vendor.<anon TriFunction>.apply`
    # is one id with rows in six files. Taking every row put that id into six span buckets and nested it under
    # unrelated methods in each — 13 defines edges that do not exist, and 56 phantom nodes in the closure.
    # The path tool builds `{r['id']: dict(r) for r in SELECT * WHERE method_id IS NOT NULL OR type_id IS NOT NULL}`
    # and filters AFTER — so an id whose last row is a TYPE row is dropped there. Filtering first and deduping
    # second keeps it, which is not the same set. The id is a hash of the display, so an anonymous class collides
    # across files (`Database.Vendor.<anon TriFunction>.apply` has rows in six), which is why this matters at all.
    one = {}
    for i, f, ln, en, mid, kind in q("""SELECT id, file, line, end_line, method_id, kind FROM symbols
                                        WHERE method_id IS NOT NULL OR type_id IS NOT NULL"""):
        one[i] = (f, ln, en, mid, kind)
    byfile = {}
    for i, (f, ln, en, mid, kind) in one.items():
        if mid and kind != 'module' and ln and en:
            byfile.setdefault(f, []).append((ln, -en, i))
    # The stack pops on END LINE against the current end line — `while st and st[-1][1] < -neg` — not on the top's
    # end against the current's START. The two agree on properly nested spans and disagree on overlapping ones,
    # which is 10 defines edges here and 56 phantom nodes once the closure walks them.
    for f, rows in byfile.items():
        rows.sort(); st = []
        for ln, neg, i in rows:
            while st and st[-1][1] < -neg: st.pop()
            if st and st[-1][2] != i: e.append((st[-1][2], i, 'defines'))
            st.append((ln, -neg, i))
    have = {(a, b) for a, b, _ in e}
    # the same narrowing the path tool applies: a candidate whose owner type is never instantiated anywhere is not a
    # dispatch the program can take. Without it the closure gains edges Soufflé never had (25 extra nodes on a
    # sampled target), because every same-named override of an uninstantiated type becomes reachable.
    disp = {(r[0], r[1]) for r in q("""SELECT DISTINCT dc.base_method_id, dc.candidate_method_id
                                       FROM dispatch_candidates dc JOIN methods m ON m.id=dc.candidate_method_id
                                       WHERE m.provenance='client' AND dc.base_method_id<>dc.candidate_method_id
                                         AND (m.owner_type_id IS NULL
                                              OR m.owner_type_id IN (SELECT type_id FROM type_instantiated)
                                              OR NOT EXISTS (SELECT 1 FROM type_instantiated))""")}
    e = [(a, b, 'dispatch' if (a, b) in disp else t) for a, b, t in e] + [(a, b, 'dispatch') for a, b in disp if (a, b) not in have]
    return e


def _rev(edges):
    r = {}
    for a, b, t in edges: r.setdefault(b, []).append((a, t))
    return r


def reach_from(rev, seeds, byname=(), cap=40):
    """up/reach: everything that can reach a seed, at its SHORTEST hop count.
    `up(q,m,0) :- seed(q,m)` · `up(q,c,1) :- seed_byname(q,c)` · `up(q,a,d+1) :- up(q,b,d), edge(a,b,_), d<cap`
    Walked a level at a time: `reach` is the MINIMUM depth, and a recursive CTE unioning on (id, depth) keeps every
    depth a node is reached at instead, which then needs a second pass to take the min."""
    depth = {m: 0 for m in seeds}
    frontier = list(depth); d = 0
    while frontier and d < cap:
        nxt = []
        for b in frontier:
            for a, _t in rev.get(b, ()):
                if a not in depth: depth[a] = d + 1; nxt.append(a)
        if d == 0:
            for c in byname:
                if c not in depth: depth[c] = 1; nxt.append(c)
        frontier = nxt; d += 1
    return depth


def parent_up(edges, depth):
    """the chain read-back: `parent_up(q,a,b,t) :- reach(q,a,d), d>0, reach(q,b,d-1), edge(a,b,t)` — a is one hop
    further from the change than b, so following it from any reached node walks down to a seed.

    DEDUPED, and sorted. A Datalog relation is a set; the edge list is not — the same call edge appears once per
    row in call_edges, so a caller with five sites to the same callee produced the same parent_up row five times.
    The chain walk sorts candidates by tier and `sorted` is stable, so duplicates skew which parent a chain takes
    and, through that, how sure the answer says a test's route is.
    """
    return sorted({(a, b, t) for a, b, t in edges
                   if a in depth and b in depth and depth[a] and depth[a] == depth[b] + 1})


import re as _re
TEST_DECOR = _re.compile(r'(^|\.)(\w*Test\w*|it|test)$')
FIXTURE_DECOR = _re.compile(r'^(Before\w*|BeforeEach|BeforeAll|BeforeClass|fixture|setup\w*)$', _re.I)
FIXTURE_NAMES = {'setUp', 'setUpClass', 'setup', 'setup_method', 'setup_class', 'setUpBeforeClass', 'beforeEach', 'beforeAll'}


TEST_REGISTRAR = re.compile(r'\b(it|test|bench)\s*(\.\w+)*\s*(\.\w+)?\s*[(<]')


def _test_sets(q, lines=None):
    """test_method and fixture, the same two sets the exporter builds — the distinction the whole test layer rests on.

    A TEST is is_test, a method or function, and either carries a @Test-shaped decoration or is named test*/it*.
    A helper in a test file (`_assertAsBigInteger`) is neither, so it is not a test: it is a CARRIER, and the tests
    it brings are the ones declared beside it. Counting every is_test callable as a test returned the helpers and
    lost the seven @Test methods they carry.
    A FIXTURE is a test type, a constructor or module, a known setUp name, or a Before*/fixture/setup* decoration.

    A jest / vitest / mocha test is an ANONYMOUS callable handed to it(…) / test(…) / bench(…), so the name test
    above it is the registrar's, not the callable's. Without that second leg the test layer of a JS or TS bundle
    is all but empty — and the shown DENOMINATOR is read from the exported facts, not from here, so the answer
    still says "N of 2846 test method(s)" and looks merely low rather than broken.
    """
    dec = {}
    for oid, name in q("SELECT owner_id, name FROM decorations") if _has(q, 'decorations') else []:
        dec.setdefault(oid, []).append(name or '')
    tm, fx = set(), set()
    for sid, name, kind, mid, tid in q("SELECT id, name, kind, method_id, type_id FROM symbols WHERE is_test=1"):
        d = dec.get(sid, ())
        if mid and kind in ('method', 'function') and (any(TEST_DECOR.search(x) for x in d) or (name or '').startswith(('test', 'it'))):
            tm.add(sid)
        if (tid and not mid) or kind in ('constructor', 'module') or name in FIXTURE_NAMES or any(FIXTURE_DECOR.match((x or '').split('.')[-1]) for x in d):
            fx.add(sid)
    # …and the anonymous ones, named as tests by the registrar written on their own declaration line
    if lines is not None:
        for sid, name, f, ln in q("""SELECT id, name, file, line FROM symbols
                                     WHERE is_test=1 AND method_id IS NOT NULL AND file IS NOT NULL AND line > 0"""):
            if not (name or '').startswith('<'): continue
            L = lines(f)
            if ln - 1 < len(L) and TEST_REGISTRAR.search(L[ln - 1]): tm.add(sid)
    return tm, fx


def tests_reaching(q, depth, sets=None, every=False):
    """test_hit: a test whose own body reaches the change, one a reached fixture runs before it, or one declared
    beside a reached carrier in a test file. Returns {test_id: (hops, via)} at the nearest hop.

    Keyed on `methods.owner_type_id`, never on `symbols.owner`, which is a DISPLAY: this bundle has two distinct
    UserProfileTest classes in different files, and matching by name merged their tests.

    Read from three maps built once. Asking the database per reached node cost 8.07 s on a hub target that
    reaches 28,080, against 0.16 s for all of it — the query was not slow, the loop around it was.
    """
    if not depth: return {}
    tm, fx = sets or _test_sets(q)
    # The exporter resolves an owner through `tid_of = {display: type_id}` built with setdefault — FIRST id wins —
    # so two distinct classes that share a display collapse to one type, and the rules inherit that. This bundle
    # has two SecureRedirectUrisEnforcerExecutorTest classes in different modules, only one of which extends
    # AbstractKeycloakTest; the rules attribute the other one's 22 tests to it anyway. Keying on the real
    # owner_type_id is strictly more precise and therefore does NOT match, so the same collapse is reproduced here.
    # (Worth fixing in the exporter — but it is a behaviour change, not a port.)
    tid_of = {}
    for disp, tid in q("SELECT display, type_id FROM symbols WHERE type_id IS NOT NULL"): tid_of.setdefault(disp, tid)

    def owner_tid(disp):
        """the exporter's own owner resolution: walk the display up until a type answers, so `Enum.CONSTANT.run`
        and an `<anon>` body land on the nearest enclosing type instead of on nothing."""
        while disp:
            if disp in tid_of: return tid_of[disp]
            disp = disp.rsplit('.', 1)[0] if '.' in disp else ''
        return None

    owner_id, file_of, kind_of = {}, {}, {}
    # the SAME row set `decl_file` is built from — g.sym is
    #   {r['id']: r for r in SELECT * WHERE method_id IS NOT NULL OR type_id IS NOT NULL}
    # so an id appearing in several files takes its file from the last row OF THAT SET. Reading every row instead
    # lets a different row win, and for ids that collide across files (a subclass test sharing a base's display)
    # that collapsed thousands of tests onto one file — 5,170 test hits that do not exist.
    for sid, f, knd, tid, mid, owner, disp in q("""SELECT id, file, kind, type_id, method_id, owner, display
                                                   FROM symbols WHERE method_id IS NOT NULL OR type_id IS NOT NULL"""):
        file_of[sid] = f; kind_of[sid] = knd
        # `member(t,m,…)` / `owner(m,t)` exist only for a symbol that is a method AND carries an owner — the
        # exporter writes no owner row for a type. That is what keeps rule 443 off type fixtures; see below.
        if mid and owner:
            t = owner_tid(owner)
            if t: owner_id[sid] = t
    tests_by_owner, tests_by_file = {}, {}
    for t in tm:
        o = owner_id.get(t)
        if o: tests_by_owner.setdefault(o, []).append(t)
        if file_of.get(t): tests_by_file.setdefault(file_of[t], []).append(t)
    # scope(t,s): t itself, then every type that extends or nests inside it — a fixture on a base class runs
    # before the tests of all its subclasses.
    # `scope(t,t)` · `scope(t,s) :- scope(t,u), extends(s,u)` · `scope(t,s) :- scope(t,u), nested(s,u)` — both
    # the subtype closure AND the nested-type one. Ancestors alone lost 22 tests declared in inner classes.
    subs = {}
    if _has(q, 'type_ancestors'):
        for tid, aid in q("SELECT type_id, ancestor_type_id FROM type_ancestors"):
            if tid != aid: subs.setdefault(aid, []).append(tid)
    if _has(q, 'nesting'):
        for inner, outer in q("SELECT type_id, outer_type_id FROM nesting"):
            if inner and outer and inner != outer: subs.setdefault(outer, []).append(inner)
    # close it: a subtype of a nested type (and vice versa) is still in scope
    for k in list(subs):
        seen, stack = set(subs[k]), list(subs[k])
        while stack:
            u = stack.pop()
            for v in subs.get(u, ()):
                if v not in seen: seen.add(v); stack.append(v)
        subs[k] = list(seen)
    test_files = {file_of[t] for t in tm if file_of.get(t)}
    istype = {r[0] for r in q("SELECT id FROM symbols WHERE type_id IS NOT NULL AND method_id IS NULL")}
    # `every=True` returns EVERY (test, hops, via) the rules derive — test_hit is not one row per test: a test
    # reached by its own body and by two fixtures is three rows, and the answer classifies routes from all of
    # them. test_near is the nearest of those, which is what the dict form gives.
    out = {}; rows = set()
    def put(m, d, via):
        rows.add((m, d, via))
        if m not in out or d < out[m][0]: out[m] = (d, via)
    for sid, d in depth.items():
        if sid in tm: put(sid, d, '')
        if sid in fx:
            # 443 — a fixture METHOD: its owner, every subtype and every nested type run it before their own
            #       tests.  `… fixture(fx), owner(fx,t), scope(t,s), member(s,m,_,_) …`
            o = owner_id.get(sid)
            for key in ([o] + subs.get(o, [])) if o else []:
                for m in tests_by_owner.get(key, ()): put(m, d, sid)
            # 444 — a fixture TYPE (a test class is itself a fixture): only its OWN members, no scope walk, and
            #       keyed on the symbol id because that is what `typ(fx,_,_), member(fx,m,_,_)` unifies on.
            #       Handing type fixtures the 443 scope walk instead attributed every subclass's tests to the
            #       base: 3,676 phantom hits through AbstractKeycloakTest alone on this bundle.
            if sid in istype:
                for m in tests_by_owner.get(sid, ()): put(m, d, sid)
        if sid not in tm and (kind_of.get(sid) in ('class', 'module') or sid in fx or file_of.get(sid) in test_files):
            for m in tests_by_file.get(file_of.get(sid), ()): put(m, d, sid)
    return rows if every else out


def _has(q, table):
    try: return bool(q("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", table))
    except Exception: return False


def _bean_call(q, ids, sites):
    """The container-bean layer on `calls it`, and the only rules in `direct` that a bundle without a container
    never exercises — which is why jackson (0 rows in ext_bean_def) was clean on it and keycloak (213) was not.

        bean_call(q,c,m) :- target(q,"method",m,_), owner(m,ot), bean(_,ot,_), calls(c,m,t,_,_), t != "multi_inferred"

    Whether the container's proxy is on the path decides whether a behavioural annotation added to the method — a
    transaction, a cache, a retry, an authorization check — reaches this caller at all. A call from inside the bean
    goes through `this` and never through the proxy. Returns the callers the plain `calls it` rule must skip, and
    the reason each one gets instead.
    """
    if not (_has(q, 'ext_bean_def') and _has(q, 'ext_inject_point')): return set(), {}
    memb, owner_disp, _tfile, tid_of, _by_tid = _members(q)

    def type_of(sid):
        """owner(x, t) — the type id the symbol's owner display resolves to."""
        r = q("SELECT owner FROM symbols WHERE id=?", sid)
        d = owner_disp(r[0][0]) if r and r[0][0] else None
        return tid_of.get(d) if d else None

    ots = {t for t in (type_of(i) for i in ids) if t}
    beans = {r[0] for r in q("SELECT c1 FROM ext_bean_def")}
    ot = next((t for t in ots if t in beans), None)
    if ot is None: return set(), {}
    # receives_bean(t, into): the type the container hands the bean to — a field injection names the type (c3), a
    # constructor or setter names the method (c4) and the type is that method's owner.
    #   receives_bean(t,into) :- injected(t,into,_), typ(into,_,_)
    #   receives_bean(t,into) :- injected(t,x,_), owner(x,into)
    istype = {r[0] for r in q("SELECT id FROM symbols WHERE type_id IS NOT NULL AND method_id IS NULL")}
    recv = set()
    for t, tgt in q("""SELECT i.c2, COALESCE(s.id, o.id) FROM ext_inject_point i
                            LEFT JOIN symbols s ON s.method_id = i.c4
                            LEFT JOIN symbols o ON o.type_id = i.c3 AND o.method_id IS NULL
                       WHERE i.c2 <> '' AND COALESCE(s.id, o.id) IS NOT NULL"""):
        if t != ot: continue
        recv.add(tgt if tgt in istype else type_of(tgt))
    callers = {c for c, tier, _f, _l in sites if tier != 'multi_inferred'}
    why = {}
    for c in callers:
        cot = type_of(c)
        if cot == ot:
            why[c] = ('calls it from inside the same bean — through this, not through the container proxy, so an '
                      'added proxied annotation does NOT apply to this caller')
        elif cot in recv:
            why[c] = ('calls it on the injected bean — the container proxy is on the path, so an added proxied '
                      'annotation applies here')
        else:
            why[c] = ('calls it on an instance it obtained itself, not from the container — no proxy on the path, '
                      'so an added proxied annotation does not apply here')
    return callers, why


def direct_for_method(q, ids):
    """direct(q,c,role,why,cert,f,l) for a method target — the rows the answer groups by *why* and *how sure*.

      calls it                                         resolved      a typed edge, any tier but multi_inferred
      calls it                                         one of a set  a multi_inferred edge: one member of a set
      calls a method of this name (receiver not typed) by name       an unresolved site naming it (not a ctor)
      a sibling of the same type / same file           alongside     no call, no reference: only that a fix touching
                                                                     one often touches the other. Never a seed.
    """
    ph = ','.join('?' * len(ids))
    rows = []
    # ordered by site line: when a caller has several call sites the answer names one of them, and the rules name
    # the lowest. Leaving the order to the table printed a different site (254 against 257) for the same caller.
    sites = q(f"""SELECT e.caller_id, e.tier, s.file_path, s.start_line
                  FROM call_edges e LEFT JOIN call_sites s ON s.id=e.call_site_id
                  WHERE e.callee_method_id IN ({ph}) AND e.callee_provenance='client'
                  ORDER BY s.start_line""", *ids)
    bean_callers, why_of = _bean_call(q, ids, sites)
    for c, tier, f, l in sites:
        if tier == 'multi_inferred':
            # rule 208 carries no `!bean_call` guard, so a multi_inferred site stays `one of a set` even into a bean
            rows.append((c, 'uses', 'calls it', 'one of a set', f or '', l or 0))
        elif c not in bean_callers:                                          # `… , !bean_call(q, c, m)`
            rows.append((c, 'uses', 'calls it', 'resolved', f or '', l or 0))
    # …and for a caller into a container-managed bean, EVERY site of it — the three bean rules end in a bare
    # `calls(c, m, _, f, l)` with no tier test, so a multi_inferred site of a bean caller is a row here too.
    for c, tier, f, l in sites:
        if c in bean_callers: rows.append((c, 'uses', why_of[c], 'resolved', f or '', l or 0))
    names = {r[0] for r in q(f"SELECT name FROM symbols WHERE id IN ({ph})", *ids) if r[0]}
    seen = {r[0] for r in rows}
    for n in names:
        for c, f, l, kind in q("""SELECT s.caller_id, s.file_path, s.start_line, s.kind FROM call_sites s
                                  JOIN unresolved_sites u ON u.call_site_id=s.id WHERE s.callee_name=?""", n):
            if kind in ('new', 'anon_new', 'CONSTRUCTOR_CALL'): continue      # !ctor_kind(k)
            rows.append((c, 'uses', 'calls a method of this name (receiver not typed)', 'by name', f or '', l or 0))
    # a method that DEFINES a bean: whoever the container injects the type it returns into (rule 189)
    rows += _bean_definition_consumers(q, ids)
    # alongside: siblings of the target's own type, then the other types declared in the same file
    owners = {r[0] for r in q(f"SELECT owner FROM symbols WHERE id IN ({ph})", *ids) if r[0]}
    memb, owner_disp, tfile, _tid, _by_tid = _members(q)
    owners = {owner_disp(o) or o for o in owners}          # target_owner(q,t) :- target(q,"method",m,_), owner(m,t)
    for o in owners:
        for c in memb.get(o, ()):
            # a caller can ALSO be a sibling: the rules have no "already reported" guard, so both rows exist and
            # the answer groups the same callable under `calls it` and under `alongside`.
            if c not in ids:
                rows.append((c, 'uses', 'a sibling of the same type', 'alongside', '', 0))
    # …and the callables of the OTHER types declared in the same file as the target's owner:
    #   alongside(q,c,"declared in the same file") :- target_owner(q,t), type_in_file(t,f), type_in_file(t2,f),
    #                                                t2 != t, callable_member(t2,c)
    # On JsonNode that is the nested OverwriteMode enum — three rows the sibling rule alone does not reach.
    # shares_field: a sibling that references the SAME field of the owner as the target does. Soufflé words those
    #   "a sibling of the same type, using the same field X"
    # and the plain ones "a sibling of the same type" — the ids are the same either way, only the wording differs,
    # which is why an id-only comparison called this exact when it was not.
    #   target_field(q,n) :- is_target_decl(q,m), ref(m,n,_,ek,_,_), !local_kind(ek), target_owner(q,t),
    #                        member(t,_,n,k), (k="field" ; k="const")
    #   shares_field(q,c,n) :- target_field(q,n), ref(c,n,_,ek,_,_), !local_kind(ek), callable_member(t,c)
    # `refs` carries (name, file, line) with no owning callable, so each ref is attributed to the innermost
    # callable whose line span contains it — the same span walk `defines` uses.
    fields = set()
    for o in owners:
        for (n, k) in q("SELECT name, kind FROM symbols WHERE owner=? AND kind IN ('field','const','enum_member')", o):
            if n: fields.add(n)
    if fields:
        # every file a MEMBER of the owner is written in, not just the file of the owner's own type symbol.
        # `member(t,c,…)` resolves the owner display to one type id, so a type owns every method written with
        # that display wherever it lives: keycloak has a jpa RealmAdapter and an infinispan one, and taking the
        # first type symbol's file left 179 rows worded "a sibling of the same type" where the rules say
        # "…, using the same field cached".
        want_files = set()
        for (f,) in q(f"SELECT file FROM symbols WHERE id IN ({ph}) AND file IS NOT NULL", *ids): want_files.add(f)
        for o in owners:
            for (f,) in q("SELECT file FROM symbols WHERE display=? AND type_id IS NOT NULL AND file IS NOT NULL", o):
                want_files.add(f)
            for c in memb.get(o, ()):
                r = q("SELECT file FROM symbols WHERE id=? AND file IS NOT NULL", c)
                if r: want_files.add(r[0][0])
        spans = {}
        for f in sorted(want_files):
            spans.setdefault(f, [])
            for cid, ln, en in q("""SELECT id, line, end_line FROM symbols WHERE file=? AND method_id IS NOT NULL
                                    AND line IS NOT NULL AND end_line IS NOT NULL""", f):
                spans[f].append((ln, en, cid))
        tgt_fields, by_caller = set(), {}
        for f, sp in spans.items():
            sp.sort(key=lambda x: (x[0], -x[1]))
            # `!local_kind(ek)`: a LOCAL_VARIABLE / PARAMETER / LAMBDA_PARAMETER reference that happens to share a
            # field's name is not a use of the field. Ignoring the entity kind made every sibling declaring a local
            # of that name look like it shared the field, so they were reported as
            # "…, using the same field X" where the rules say plainly "a sibling of the same type".
            for name, rf, rl, ek in q("""SELECT name, file, line, entity_kind FROM refs
                                         WHERE file=? AND name IS NOT NULL""", f):
                if ek in LOCAL_KINDS: continue
                if name not in fields: continue
                inner = None
                for ln, en, cid in sp:
                    if ln <= (rl or 0) <= en: inner = cid
                if inner is None: continue
                if inner in ids: tgt_fields.add(name)
                by_caller.setdefault(inner, set()).add(name)
        # ONE ROW PER SHARED FIELD: `shares_field(q,c,n)` is keyed on the field, so a sibling that references three
        # of the target's fields is three rows, each naming one — and rule 329 only emits the plain
        # "a sibling of the same type" for siblings that share NONE. Collapsing them to a single row naming the
        # first field gave 40 rows where the rules give 80, and it only shows on a type with more than one field,
        # which is why six hand-picked fixtures did not catch it.
        expanded = []
        for r in rows:
            if r[3] != 'alongside' or r[2] != 'a sibling of the same type':
                expanded.append(r); continue
            shared = sorted(by_caller.get(r[0], set()) & tgt_fields)
            if shared:
                for n in shared:
                    expanded.append((r[0], r[1], f'a sibling of the same type, using the same field {n}', r[3], r[4], r[5]))
            else:
                expanded.append(r)
        rows = expanded
    # only the ALONGSIDE rows emitted so far — building this from every row folds in the resolved callers, and a
    # caller that also lives in the target's file then never gets its `declared in the same file` row.
    sib = {r[0] for r in rows if r[3] == 'alongside'}
    for o in owners:
        # `symbols.owner` is a DISPLAY name, not an id — looking the owning type up by id silently found nothing.
        # `type_in_file(t2, f)` resolves t2 through the same {display: type_id} map, first id wins — so a member
        # whose owner DISPLAY is ambiguous belongs to whichever file that first id sits in, not to the file the
        # member is written in. This bundle has six classes called `Config`; matching by file alone attributed
        # seven members of one of them to a nested class in another.
        # target_owner(q,t) is a type ID; type_in_file(t,f) is THAT symbol's file
        t_own = _tid.get(o)
        for (f,) in (q("SELECT file FROM symbols WHERE id=? AND file IS NOT NULL", t_own) if t_own else []):
            for c, _t2 in _same_file_members(q, t_own, f):
                # same as the sibling rule: a CALLER can also be declared in the same file, and rule 330 has no
                # "already reported" guard — only `t2 != t`. Excluding callers here dropped the one row that kept
                # this bundle from parity (LDAPOperationManager.<anon LdapOperation>.execute, which calls the
                # target AND lives in its file).
                if c not in ids and c not in sib:
                    rows.append((c, 'uses', 'declared in the same file', 'alongside', '', 0)); sib.add(c)
    # DEDUPED: a Datalog relation is a set. Duplicate rows here inflate the per-caller site count the formatter
    # sorts on and caps by, so the same answer prints a different subset — 35 rows for 31 distinct ones was enough
    # to change which callers appeared at all.
    seen_row = set(); uniq = []
    for r in rows:
        if r not in seen_row: seen_row.add(r); uniq.append(r)
    return uniq


_MEM_IDX = {}
def _members(q):
    """`member(t,c,_,k)` for the callables, keyed by the type DISPLAY the owner resolves to, plus that resolver
    and each type's file.

    `symbols.owner` is a display and does not have to name a type: a method on an enum constant body is owned by
    `MyEnum2457Base.B`, which has no type row at all. The exporter walks the display up until a type answers
    (`owner_tid`), so `B.foo` is a member of `MyEnum2457Base`. Matching `owner = ?` exactly instead dropped every
    such method — three `alongside` rows on EnumAsMapKeySerializationTest, where each enum constant overrides
    `foo`, and `B.foo` was not even recognised as a sibling of its own enum.
    """
    key = id(q)
    if key not in _MEM_IDX:
        # tid_of: display -> type id, FIRST id wins, exactly as the exporter builds it
        tfile, tid_of = {}, {}
        for disp, f, t in q("SELECT display, file, type_id FROM symbols WHERE type_id IS NOT NULL"):
            tfile.setdefault(disp, f); tid_of.setdefault(disp, t)
        up = {}
        def owner_disp(d):
            """the display of the nearest enclosing type, or None — `owner_tid` without the last lookup."""
            if d in up: return up[d]
            o = d
            while o and o not in tfile: o = o.rsplit('.', 1)[0] if '.' in o else ''
            up[d] = o or None
            return up[d]
        idx, by_tid = {}, {}
        # table order, so a sibling list comes out in the same order the old `WHERE owner = ?` gave it
        for i, o, n, k in q("SELECT id, owner, name, kind FROM symbols WHERE method_id IS NOT NULL AND owner IS NOT NULL"):
            t = owner_disp(o)
            if t:
                idx.setdefault(t, []).append(i)
                if t in tid_of: by_tid.setdefault(tid_of[t], []).append((i, n, k))
        # FIELDS are members too — `declares(t,n) :- member(t,_,n,_)` is how a subclass shadows an inherited name.
        # The exporter keys a field on `tid_of[f.owner]` with NO walk-up (unlike a method), falling back to the
        # file's module node, so this reproduces that exactly rather than reusing owner_disp.
        mod_of = {}
        for i, f in q("SELECT id, file FROM symbols WHERE kind='module' AND file IS NOT NULL"):
            mod_of.setdefault(f, i)
        for rid, fid, o, n, k, f in q("""SELECT rowid, id, owner, name, kind, file FROM symbols
                                         WHERE method_id IS NULL AND type_id IS NULL
                                         AND kind IN ('field','const','enum_member','variable')"""):
            t = tid_of.get(o or '') or mod_of.get(f or '')
            if t: by_tid.setdefault(t, []).append((fid or f"f:{rid}", n, k))
        _MEM_IDX[key] = (idx, owner_disp, tfile, tid_of, by_tid)
    return _MEM_IDX[key]


_OWNER_FILE = {}
def _owner_file(q, disp):
    """the file of the type a DISPLAY resolves to — first id wins, as the exporter's tid_of does."""
    if disp not in _OWNER_FILE:
        r = q("SELECT file FROM symbols WHERE display=? AND type_id IS NOT NULL LIMIT 1", disp)
        _OWNER_FILE[disp] = r[0][0] if r else None
    return _OWNER_FILE[disp]


_INJECTED = {}
def _injected(q):
    """`injected(t,into,kind)` — the exporter's own query, verbatim.

    c4 is the method that receives the value and is '-' for a FIELD injection, the case with no call site at all;
    a field injection is attributed to the type that declares it (c3). An inner join here drops about half of
    every project's injection points, which is why both legs are LEFT.
    """
    key = id(q)
    if key not in _INJECTED:
        idx = {}
        if _has(q, 'ext_inject_point'):
            for t, into, kind in q("""SELECT i.c2, COALESCE(s.id, o.id), i.c0 FROM ext_inject_point i
                                           LEFT JOIN symbols s ON s.method_id = i.c4
                                           LEFT JOIN symbols o ON o.type_id = i.c3 AND o.method_id IS NULL
                                      WHERE i.c2 <> '' AND COALESCE(s.id, o.id) IS NOT NULL"""):
                idx.setdefault(t, set()).add((into, kind or 'injected'))
        _INJECTED[key] = idx
    return _INJECTED[key]


def _bean_definition_consumers(q, ids):
    """Rule 189 — a method that DEFINES a bean (@Bean): whoever the container injects that type into.

        direct(q,c,"uses",cat("is injected with the bean this defines (",kind,")"),"resolved","",0) :-
            target(q,"method",m,_), owner(m,ot), bean(_,ot,_), injected(ot,c,kind), c != m

    There is no call site anywhere on this path — the container is the caller — so nothing else in `direct`
    finds these rows.
    """
    if not (_has(q, 'ext_bean_def') and _has(q, 'ext_inject_point')): return []
    _idx, owner_disp, _tf, tid_of, _bt = _members(q)
    beans = {r[0] for r in q("SELECT c1 FROM ext_bean_def")}
    inj = _injected(q)
    out = set()
    ph = ','.join('?' * len(ids))
    for m, o in q(f"SELECT id, owner FROM symbols WHERE id IN ({ph})", *ids):
        d = owner_disp(o) if o else None
        ot = tid_of.get(d) if d else None
        if not ot or ot not in beans: continue
        for c, kind in inj.get(ot, ()):
            if c != m:
                out.add((c, 'uses', f'is injected with the bean this defines ({kind})', 'resolved', '', 0))
    return sorted(out)


def _name_match_contract(q, ids):
    """Rules 166/168, which fire only under `flag("no_overrides")` — a bundle whose engine emits no override rows.

        contract(q,o,"declares the same member in a subtype (…)")   :- owner(m,t), member(t,m,n,_),
                                                                       extends(s,t), member(s,o,n,_), o != m
        contract(q,o,"declares the same member in a supertype (…)") :- owner(m,t), member(t,m,n,_),
                                                                       extends(t,u), member(u,o,n,_), o != m

    Dropping this tier does not merely lose the contract rows: `seed_of(q,c) :- contract(q,c,_)`, so the closure
    loses its seeds with them. On a JS bundle that took one method target from 18 tests reaching the change to 1.
    """
    if not _has(q, 'type_ancestors'): return []
    _idx, owner_disp, _tf, tid_of, by_tid = _members(q)
    ph = ','.join('?' * len(ids))
    tgt = {}
    for i, o, n in q(f"SELECT id, owner, name FROM symbols WHERE id IN ({ph})", *ids):
        d = owner_disp(o) if o else None
        t = tid_of.get(d) if d else None
        if t and n: tgt[i] = (n, t)
    if not tgt: return []
    ts = sorted({t for _n, t in tgt.values()})
    tph = ','.join('?' * len(ts))
    subs, sups = {}, {}
    for s_, t_ in q(f"SELECT type_id, ancestor_type_id FROM type_ancestors WHERE ancestor_type_id IN ({tph})", *ts):
        subs.setdefault(t_, []).append(s_)
    for s_, t_ in q(f"SELECT type_id, ancestor_type_id FROM type_ancestors WHERE type_id IN ({tph})", *ts):
        sups.setdefault(s_, []).append(t_)
    out = []
    for m, (n, t) in tgt.items():
        # `member(t,m,n,_)`: the target has to be a member of that type under that name
        if not any(mm == m for mm, _n, _k in by_tid.get(t, ())): continue
        for rel, why in ((subs, 'declares the same member in a subtype (a name match: this graph has no override table)'),
                         (sups, 'declares the same member in a supertype (a name match: this graph has no override table)')):
            for other in rel.get(t, ()):
                for o, nn, _k in by_tid.get(other, ()):
                    if nn == n and o != m: out.append((o, why))
    return out


def contract_for_method(q, ids):
    """contract(q,c,why) for a method target: `overrides it` / `it overrides this`, the target never itself."""
    ph = ','.join('?' * len(ids))
    out = []
    for (o,) in q(f"SELECT overriding_method_id FROM overrides WHERE method_id IN ({ph})", *ids):
        if o not in ids: out.append((o, 'overrides it'))
    for (b,) in q(f"SELECT method_id FROM overrides WHERE overriding_method_id IN ({ph})", *ids):
        if b not in ids: out.append((b, 'it overrides this'))
    # flag("no_overrides") :- the bundle has no `overrides` rows at all. The types are still there, so a same-named
    # member of a sub- or supertype is bound by the same contract, said as a name match rather than as an override.
    if not q("SELECT 1 FROM overrides LIMIT 1"): out += _name_match_contract(q, ids)
    return sorted(set(out))                       # a set, for the same reason


# ── solve: the dict `Impact.run()` returns, without the .facts round trip ─────────────────────────────────────

SOLVE_KINDS = {'method', 'type', 'field', 'decoration', 'string', 'config', 'newconst'}   # else: the rules


def _ckey(k):
    """the canonical form of a configuration key: a framework binds app.serverPrefix, app.server-prefix,
    app.server_prefix and APP_SERVER_PREFIX to the same property, so every spelling collapses to one."""
    return re.sub(r'[^a-z0-9.]', '', (k or '').lower())


_DEC_LITS = {}
def _dec_literals(q, at):
    """`dec_literal(c,d,v,f,l)` — the strings written INSIDE a decoration.

    @Listener(topics = "topicOne"), @RequestMapping("/a/{b}"), @Value("${app.prefix}"). `literals` does not carry
    these at all, and they are how a topic, a queue, a route, a bean qualifier or a configuration key binds.
    """
    key = id(q)
    if key not in _DEC_LITS:
        rows = []
        for oid, name, text, f, l in (q("SELECT owner_id, name, text, file, line FROM decorations "
                                        "WHERE text IS NOT NULL AND text <> ''") if _has(q, 'decorations') else []):
            c = at(f, l) or oid
            if not c: continue
            for v in set(re.findall(r'"{1,3}([^"]{1,120})"{1,3}', text or '')):
                rows.append((c, (name or '').split('.')[-1], v, f or '', l or 0))
        _DEC_LITS[key] = sorted(set(rows))
    return _DEC_LITS[key]


def direct_for_config(q, keys, at, rel):
    """Rules 181/183 — a CONFIGURATION KEY as the target.

        direct(q,m,"reads",cat("reads this configuration key (",why,")"),"resolved","",0) :- config(k,m,why)
        direct(q,c,"produces",cat("BINDS the key here, at the @",dn," placeholder — …"),"resolved",f,l)
                                                                                   :- config_site(k,c,dn,f,l)

    No call reaches a method the container binds a key into, so nothing else in `direct` finds these. The binding
    site is the one line that ties the key to the code, and the one a rename has to change with it.
    Returns (rows, readers) — the readers are seeded by rule 371 directly, not only through the generic rule.
    """
    rows, readers = [], set()
    if _has(q, 'ext_config_affects_method'):
        for k, m, why in q("SELECT a.c0, a.c1, a.c2 FROM ext_config_affects_method a "
                           "JOIN symbols s ON s.method_id = a.c1"):
            if _ckey(k) not in keys: continue
            readers.add(m)
            rows.append((m, 'reads', f"reads this configuration key ({why or 'bound'})", 'resolved', '', 0))
    # config_site(k,c,dn,f,l) :- dec_literal(c,dn,v,f,l), the ${…} placeholders written in v — or v itself when it
    # is already a dotted key. Matched on the canonical key, so the spelling at the site need not be the one asked.
    for c, dn, v, f, l in _dec_literals(q, at):
        found = re.findall(r'\$\{\s*([A-Za-z0-9_.\-]+)\s*(?::[^}]*)?\}', v)
        if not found and re.fullmatch(r'[A-Za-z0-9_.\-]+\.[A-Za-z0-9_.\-]+', v): found = [v]
        for k in found:
            if _ckey(k) in keys:
                rows.append((c, 'produces', f"BINDS the key here, at the @{dn} placeholder — this is the line a "
                                            f"rename must change", 'resolved', rel(f) if f else '', l or 0))
    return sorted(set(rows)), readers


def direct_for_decoration(q, ids):
    """Rule 336 — an ANNOTATION as the target: the declarations that carry it.

        direct(q,c,"uses","carries this decoration","resolved","",0) :- target(q,"decoration",c,_)

    The target ids ARE the carriers (the skill resolves `@Name` to them), so there is nothing to join. What the
    framework DOES with the annotation is not in the graph, and no rule pretends otherwise.
    """
    return [(c, 'uses', 'carries this decoration', 'resolved', '', 0) for c in ids]


def direct_for_string(q, vals, at, rel):
    """Rules 401/402 — a STRING as the target: a topic, a queue, a route, a bean qualifier.

        direct(q,c,"uses","names it in a string literal","text",f,l)      :- literal(c,v,f,l)
        direct(q,c,"uses",cat("binds to it through @",d),"text",f,l)      :- dec_literal(c,d,v,f,l)

    A name in a namespace that is not the code's: the compiler is silent about it and a rename breaks it at run
    time. `literal` is the exporter's filtered view of `literals` — an identifier-shaped value under 64 chars —
    and `dec_literal` is the strings written INSIDE a decoration, which `literals` does not carry at all.
    """
    rows = []
    if _has(q, 'literals'):
        for v, f, l in q("SELECT value, file, line FROM literals WHERE value GLOB '[A-Za-z_]*' AND length(value) < 64"):
            if v not in vals or not re.fullmatch(r'[A-Za-z_]\w*', v): continue
            c = at(f, l)
            if c: rows.append((c, 'uses', 'names it in a string literal', 'text', rel(f) if f else '', l or 0))
    for c, d, v, f, l in _dec_literals(q, at):
        if v in vals:
            rows.append((c, 'uses', f"binds to it through @{d}", 'text', rel(f) if f else '', l or 0))
    return sorted(set(rows))
BASE_REF_SQL = ("SELECT name, line FROM type_refs WHERE file=? AND context IN "
                "('BASE_CLASS','SUPER_TYPE','IMPLEMENTS_INTERFACE','EXTENDS_TYPE')")
GEN_DECOR = {'Data', 'Getter', 'Setter', 'Value', 'Builder', 'AllArgsConstructor',
             'RequiredArgsConstructor', 'With', 'Accessors', 'dataclass', 'attrs', 'define', 'BaseModel'}

def inherited_tests(q, hits):
    """`inherited_test(q,s,m,d) :- test_hit(q,m,d,_), owner(m,t), extends(s,t), typ(s,_,_), s != t` — the test
    classes that extend a class whose test was reached run that test too, in their own file."""
    if not hits: return []
    # the owner resolved the way the exporter does — through {display: type_id} with setdefault, first id wins —
    # not through methods.owner_type_id. The real id is more precise and gives 475 inheriting classes where the
    # rules give 458; see the note in tests_reaching.
    tid_of = {}
    for disp, tid in q("SELECT display, type_id FROM symbols WHERE type_id IS NOT NULL"): tid_of.setdefault(disp, tid)
    # `owner(m,t)` the way the exporter writes it: methods only, and the display walked up until a type answers
    def owner_tid(disp):
        while disp:
            if disp in tid_of: return tid_of[disp]
            disp = disp.rsplit('.', 1)[0] if '.' in disp else ''
        return None
    owner_id = {}
    for sid, owner in q("SELECT id, owner FROM symbols WHERE owner IS NOT NULL AND method_id IS NOT NULL"):
        t = owner_tid(owner)
        if t: owner_id[sid] = t
    subs = {}
    if _has(q, 'type_ancestors'):
        for tid, aid in q("SELECT type_id, ancestor_type_id FROM type_ancestors"):
            if tid != aid: subs.setdefault(aid, []).append(tid)
    istype = {r[0] for r in q("SELECT id FROM symbols WHERE type_id IS NOT NULL AND method_id IS NULL")}
    out = set()
    for m, d, _via in hits:
        t = owner_id.get(m)
        if not t: continue
        for sub in subs.get(t, ()):
            if sub in istype and sub != t: out.add((sub, m, d))
    return sorted(out)


NON_CALLABLE_KINDS = {'field', 'const', 'enum_member', 'variable'}

MEMBER_KINDS = {'FIELD', 'PROPERTY', 'ATTRIBUTE', 'METHOD', 'FUNCTION'}
CTOR_KINDS = {'new', 'anon_new', 'CONSTRUCTOR_CALL'}


SWITCH_RE = re.compile(r'\bswitch\s*[(\s]|\bmatch\s+\w+\s*:')
CONST_RE = re.compile(r'\b[A-Z][A-Z0-9_]{1,}\b')
_SWITCH_OVER = {}


def switch_over(q, tids, code):
    """`switch_over(m,t,arms)` — the callables that switch over an enum, and how many of its constants they name.

    The one relation an enum target rests on, and the reason an enum used to decline here: the exporter reads it
    from each callable's own text rather than from a table, because the parser mislabels switch arms. Same read,
    restricted to the enums actually asked about, so it is one pass over the callables instead of a table scan.

    Returns {type id: [(callable id, arms)…]}.
    """
    want = tuple(sorted(tids))
    key = (id(q), want)
    if key in _SWITCH_OVER: return _SWITCH_OVER[key]
    consts = {}
    for owner, name in q("SELECT owner, name FROM symbols WHERE kind='enum_member'"):
        if owner and name: consts.setdefault(owner, set()).add(name)
    # `enum_disp` is keyed on the DISPLAY, as the exporter builds it, and only the asked-for enums are kept
    enums = {}
    ph = ','.join('?' * len(want))
    for disp, tid in q(f"SELECT display, id FROM symbols WHERE kind='enum' AND type_id IS NOT NULL "
                       f"AND id IN ({ph})", *want):
        if disp and consts.get(disp): enums[disp] = tid
    out = {}
    if not enums: return _SWITCH_OVER.setdefault(key, out)
    for sid, f, ln, en in q("""SELECT id, file, line, end_line FROM symbols
                               WHERE method_id IS NOT NULL AND file IS NOT NULL AND line > 0"""):
        L = code(f)
        if not L or ln > len(L): continue
        body = '\n'.join(L[ln - 1:min(en or ln, len(L))])
        if not SWITCH_RE.search(body): continue
        names = set(CONST_RE.findall(body))
        for disp, tid in enums.items():
            hit = names & consts[disp]
            if hit: out.setdefault(tid, []).append((sid, str(len(hit))))
    return _SWITCH_OVER.setdefault(key, out)


def direct_for_newconst(q, tids, code, inside):
    """Rules 340/341 — a constant that DOES NOT EXIST YET (`Enum.<new>`).

        direct(q,c,"uses",cat("switches over it (",arms," of its constants named) — a new constant needs an arm
                              here"),"resolved","",0)                        :- switch_over(c,t,arms)
        direct(q,c,"uses","a member of the enum","alongside","",0)           :- callable_member(t,c)

    The question cannot be asked of a declaration, because the declaration is what the edit will add — so the
    impact is every switch that would silently fall through, plus the enum's own members.
    Returns (rows, switchers) — the switchers are seeded by rule 370 directly.
    """
    rows, switchers = [], set()
    sw = switch_over(q, tids, code)
    for t in tids:
        for c, arms in sw.get(t, ()):
            switchers.add(c)
            rows.append((c, 'uses', f"switches over it ({arms} of its constants named) — a new constant needs "
                                    f"an arm here", 'resolved', '', 0))
    _memb, _od, _tf, _tid, by_tid = _members(q)
    for t in tids:
        for m, _n, k in by_tid.get(t, ()):
            if k in NON_CALLABLE_KINDS: continue          # callable_member(t,c): k != field/const/enum_member/variable
            rows.append((m, 'uses', 'a member of the enum', 'alongside', '', 0))
    return sorted(set(rows)), switchers


def direct_for_type(q, tids, at, inside, textuse, importuse, rel, code=None):
    """`direct(q,c,role,why,cert,f,l)` for a TYPE target — who instantiates it, calls into it, names it.

    `at(file, line)` is the impact object's own innermost-callable walk and `rel(path)` its site-file mapping;
    both are handed in rather than rebuilt here, because a second implementation of the same span lookup is
    where this port has gone wrong most often.

    `inside` is inside_target(q,c): the target type's own body — its members and nested types. Every rule below
    ends in `!inside_target(q,c)`, so a change to the type is never reported as a dependent of itself.
    """
    rows = []
    memb, _od, _tf, _tid, by_tid = _members(q)
    names = {}
    for t in tids:
        r = q("SELECT name, kind FROM symbols WHERE id=?", t)
        if r: names[t] = (r[0][0], r[0][1])

    # ── a type the container INJECTS (rule 186) ────────────────────────────────────────────────────────────
    #   direct(q,c,"uses",cat("receives it by dependency injection (",kind,") — …"),"resolved","",0)
    #     :- target(q,"type",t,_), injected(t,c,kind), !inside_target(q,c)
    # Its consumers receive it with no call site the graph can see, so no other rule in `direct` reaches them.
    inj = _injected(q)
    for t in tids:
        for c, kind in sorted(inj.get(t, ())):
            if c in inside: continue
            rows.append((c, 'uses', f'receives it by dependency injection ({kind}) — the container hands it '
                                    f'over, no call site', 'resolved', '', 0))

    # ── an ENUM type: the switches over it (rule 343) ──────────────────────────────────────────────────────
    #   direct(q,c,"uses",cat("switches over the enum (",arms," of its constants named)"),"resolved","",0)
    #     :- target(q,"type",t,_), typ(t,_,"enum"), switch_over(c,t,arms), !inside_target(q,c)
    if code is not None:
        enums = [t for t in tids if names.get(t, ('', ''))[1] == 'enum']
        if enums:
            sw = switch_over(q, enums, code)
            for t in enums:
                for c, arms in sw.get(t, ()):
                    if c in inside: continue
                    rows.append((c, 'uses', f'switches over the enum ({arms} of its constants named)',
                                 'resolved', '', 0))

    # ── the type's own members, reached through their callers ──────────────────────────────────────────────
    #   tmember(q,m,n,k) :- target(q,"type",t,_), member(t,m,n,k)
    #   267 produces "instantiates it" for a constructor · 268/269 "calls <n>" for everything else
    mem = [(m, n, k) for t in tids for (m, n, k) in by_tid.get(t, ())]
    if mem:
        mids = [m for m, _n, _k in mem]
        kind_of = {m: (n, k) for m, n, k in mem}
        mph = ','.join('?' * len(mids))
        for c, m, tier, f, l in q(f"""SELECT e.caller_id, e.callee_method_id, e.tier, s.file_path, s.start_line
                                      FROM call_edges e LEFT JOIN call_sites s ON s.id=e.call_site_id
                                      WHERE e.callee_method_id IN ({mph}) AND e.callee_provenance='client'
                                      ORDER BY s.start_line""", *mids):
            if c in inside: continue
            n, k = kind_of.get(m, ('', ''))
            loc = rel(f) if f else ''
            if k == 'constructor':
                rows.append((c, 'produces', 'instantiates it', 'resolved', loc, l or 0))
            else:
                rows.append((c, 'uses', f'calls {n}',
                             'one of a set' if tier == 'multi_inferred' else 'resolved', loc, l or 0))

    for t in tids:
        n = names.get(t, ('', ''))[0]
        if not n: continue
        # 270 — an unresolved NEW site written with the type's name. The exporter normalises a site's kind to
        # 'new' or 'method' and keeps only the last dotted segment of the name, so ctor_kind(k) is k == 'new'.
        for c, nm, k, f, l in q("""SELECT s.caller_id, s.callee_name, s.kind, s.file_path, s.start_line
                                   FROM call_sites s JOIN unresolved_sites u ON u.call_site_id=s.id
                                   WHERE s.callee_name IS NOT NULL AND s.callee_name<>''"""):
            if (nm or '').split('.')[-1] != n or k not in CTOR_KINDS: continue
            if c in inside: continue
            rows.append((c, 'produces', 'instantiates it (unresolved site)', 'by name',
                         rel(f) if f else '', l or 0))
        # 271 / 272 — a reference to the name. A .class literal is how a framework produces the type; anything
        # else that is not a local and not a member access is a plain reference.
        if _has(q, 'refs'):
            for nm, f, l, kk, ek in q("""SELECT name, file, line, kind, entity_kind FROM refs
                                         WHERE line > 0 AND name = ?""", n):
                c = at(f, l)
                if not c or c in inside: continue
                e = 'CLASS_LITERAL' if kk == 'CLASS_LITERAL' else (ek or '')
                if e == 'CLASS_LITERAL':
                    rows.append((c, 'produces',
                                 'reflects on its .class — deserialization or a framework produces it here',
                                 'by name', f, l))
                elif e not in LOCAL_KINDS and e not in MEMBER_KINDS:
                    rows.append((c, 'uses', 'references it', 'by name', f, l))
        # 273 — the name written in a type position: the context says which (a field type, a parameter, a cast)
        if _has(q, 'type_refs'):
            for nm, f, l, ctx in q("""SELECT name, file, line, context FROM type_refs
                                      WHERE line > 0 AND name = ?""", n):
                c = at(f, l)
                if c and c not in inside: rows.append((c, 'uses', f'names it ({ctx})', 'by name', f, l))
        # 274 — the name in the text of a file the parser gave no line for
        for c, nm, f, l in textuse:
            if nm == n and c not in inside:
                rows.append((c, 'uses', 'names it (a signature or a declaration)', 'text', f, l))
    # 275 — a name imported FROM the type (a static import), used here. Keyed on the imported member, not on the
    # type's own name, so it is not inside the per-type loop.
    for c, nm, f, l in importuse:
        if c not in inside: rows.append((c, 'uses', f'uses {nm}, imported from it', 'by name', f, l))
    return rows


QUALIFIED_REF_KINDS = {'FIELD_ACCESS', 'PROPERTY_ACCESS', 'ATTRIBUTE_ACCESS'}
TYPE_OR_CALL_KINDS = {'TYPE', 'METHOD', 'FUNCTION', 'CONSTRUCTOR', 'METHOD_CALL', 'METHOD_REFERENCE'}
SELF_QUALIFIERS = {'this', 'self', 'cls', 'super'}


def field_rec(q, fid):
    """`field(fl,t,n,f,l)` for one field id, rebuilt the way the exporter writes it.

    The id is the symbol's own id when it has one and `f:<rowid>` when it does not — and `field_type` is keyed on
    the rowid form ALWAYS, so `holds` through rule 154 only fires for fields with no id of their own. That is the
    exporter's own inconsistency, reproduced here rather than corrected, because correcting it changes answers.
    """
    memb, owner_disp, _tf, tid_of, _bt = _members(q)
    row = None
    if isinstance(fid, str) and fid.startswith('f:'):
        r = q("SELECT rowid, id, owner, name, file, line, kind FROM symbols WHERE rowid=?", int(fid[2:]))
        if r: row = r[0]
    else:
        r = q("""SELECT rowid, id, owner, name, file, line, kind FROM symbols WHERE id=?
                 AND method_id IS NULL AND type_id IS NULL""", fid)
        if r: row = r[0]
    if not row: return None
    _rid, _id, owner, name, f, l, kind = row
    t = tid_of.get(owner_disp(owner) or '') if owner else None
    if not t:                                   # a module-level declaration: its module node is its owner
        r = q("SELECT id FROM symbols WHERE kind='module' AND file=? LIMIT 1", f)
        t = r[0][0] if r else None
    return (t, name, f or '', l or 0, kind, _rid)


_SYM_IDX = {}
def _sym(q):
    """id -> (owner, method_id, name, display, file, line, end_line, kind), read once.

    `symbols.id` carries no index in the bundle, so every `WHERE id = ?` is a full table scan. One field target
    made 2,946 of them and spent 14.2 s of a 15 s query inside `SELECT owner, method_id FROM symbols WHERE id=?`.
    """
    key = id(q)
    if key not in _SYM_IDX:
        _SYM_IDX[key] = {r[0]: r[1:] for r in q("""SELECT id, owner, method_id, name, display, file, line,
                                                   end_line, kind FROM symbols""")}
    return _SYM_IDX[key]


_REL_IDX = {}
def _rel_index(q):
    """ancestors-up, nesting-in and each type's name, built ONCE per connection.

    `_declares` used to issue `type_ancestors WHERE type_id = ?` per call. Neither column is indexed, so each
    call scanned the table: 481 calls cost 15.6 s of a 31 s query. `_scope` rebuilt the whole down-map per field
    for the same reason.
    """
    key = id(q)
    if key not in _REL_IDX:
        up, down, nest_in = {}, {}, {}
        if _has(q, 'type_ancestors'):
            for a, b in q("SELECT type_id, ancestor_type_id FROM type_ancestors"):
                up.setdefault(a, []).append(b); down.setdefault(b, []).append(a)
        if _has(q, 'nesting'):
            for a, b in q("SELECT type_id, outer_type_id FROM nesting"):
                down.setdefault(b, []).append(a); nest_in.setdefault(b, []).append(a)
        nm = {i: n for i, n in q("SELECT id, name FROM symbols WHERE type_id IS NOT NULL AND method_id IS NULL")}
        _REL_IDX[key] = (up, down, nest_in, nm, {})
    return _REL_IDX[key]


def _scope(q, t):
    """`scope(t,t)` · `scope(t,s) :- scope(t,u), extends(s,u)` · `scope(t,s) :- scope(t,u), nested(s,u)` — a
    member of t is visible unqualified inside t, inside a subtype, and inside a type nested in either."""
    _up, down, _ni, _nm, _c = _rel_index(q)
    seen, stack = {t}, [t]
    while stack:
        u = stack.pop()
        for v in down.get(u, ()):
            if v not in seen: seen.add(v); stack.append(v)
    return seen


def _declares(q, t):
    """`declares(t,n)`: a member of t, a member of anything t extends, or a nested type of that name.

    Keyed on the type ID, because `member(t,_,n,_)` is. Falling back to `WHERE owner = <display>` merges every
    class that shares a display: keycloak has two `ParTest` classes and only one of them extends the base that
    declares REALM_NAME, so the display lookup shadowed 18 rows the rules report.
    """
    up, _down, nest_in, nm, memo = _rel_index(q)
    if t in memo: return memo[t]
    _memb, _od, _tf, _tid, by_tid = _members(q)
    out = set()
    for u in [t] + list(up.get(t, ())):
        out |= {n for _c, n, _k in by_tid.get(u, ()) if n}
    for x in nest_in.get(t, ()):                              # a nested type of that name is a member too
        if nm.get(x): out.add(nm[x])
    memo[t] = out
    return out


def direct_for_field(q, fids, at, code, lines, inside, rel):
    """`direct` for a FIELD target — 33 rules, the largest kind. A field has no call edges of its own, so almost
    everything here is a reference judged by WHERE it is and HOW it is written.

      fref(q,c,rk,f,l)  a reference to the field's name that is not a local, not a type and not a call, and is
                        not the declaration itself. `rk` is "qualified" (obj.name) or "bare" (name).
      in scope          the reference sits inside the owning type, a subtype, or a type nested in one — the
                        strongest a field reference gets, because the name resolves there.
      by name           it does not, so the name alone carries it.

    Returns (rows, seeds_extra, direct_edges).
    """
    rows, de = [], []
    memb, _od, _tf, tid_of, by_tid = _members(q)
    sym = _sym(q)
    for fid in fids:
        rec = field_rec(q, fid)
        if not rec: continue
        t, n, ff, fll, fkind, rid = rec
        if not n: continue
        scope = _scope(q, t) if t else set()
        # `!declares(s, n)` in rules 233/235/238 is on **s, the CALLER's owning type**, not on the field's owner:
        # the test is whether the enclosing type has a member of that name ITSELF, which would shadow the
        # reference. Computing it once for t instead suppressed every row whose caller lives elsewhere — `date`
        # is a member of the target's own type, so one lookup killed all 19 `input.date` rows.
        _dec_cache = {}
        def declares_of(s_):
            if s_ not in _dec_cache: _dec_cache[s_] = _declares(q, s_) if s_ else set()
            return _dec_cache[s_]
        # ── fref: every reference to the name, attributed to its innermost callable ────────────────────────
        fref = []
        if _has(q, 'refs'):
            for nm, rf, rl, kk, ek in q("""SELECT name, file, line, kind, entity_kind FROM refs
                                           WHERE line > 0 AND name = ?""", n):
                e = 'CLASS_LITERAL' if kk == 'CLASS_LITERAL' else (ek or '')
                if e in LOCAL_KINDS: continue
                if e in TYPE_OR_CALL_KINDS and not (fkind == 'enum_member' and e == 'TYPE'): continue
                if rf == ff and rl == fll: continue                       # the declaration itself
                c = at(rf, rl)
                if not c: continue
                rk = 'qualified' if kk in QUALIFIED_REF_KINDS else 'bare'
                fref.append((c, rk, rf, rl, e))
        owner_of = {}
        for c, _rk, _f, _l, _e in fref:
            if c in owner_of: continue
            # `owner(m,t)` exists only for a symbol that is a METHOD and carries an owner — the exporter writes
            # no owner row for a type. An anonymous class is a type, so a reference attributed to one has NO
            # owner and takes rule 240 (`!owner(c,_)`), not 238. Reading the owner column regardless of kind
            # sent it down 238 and `declares` then suppressed it: 7 rows on each of three MAPPER fields.
            row = sym.get(c)
            if row and row[0] and row[1]:
                d = _od(row[0])
                owner_of[c] = tid_of.get(d) if d else None
            else:
                owner_of[c] = None
        tname = sym.get(t, (None, None, None))[2] if t else None
        # 228-240 are SEPARATE rules over the same fref row and they UNION: a qualified reference outside the
        # scope can be both `in scope` (231, the qualifier is the owner's own type name) and `by name` (233, some
        # other qualifier). Written as an if/elif chain this picked one and lost 19 rows on one field alone.
        typenames = {r[0] for r in q("SELECT name FROM symbols WHERE type_id IS NOT NULL AND name IS NOT NULL")}
        for c, rk, rf, rl, _e in fref:
            s_ = owner_of.get(c)
            role, why = ('uses', 'writes/reads it') if rk == 'qualified' else ('reads', 'reads it')
            in_scope = (s_ is not None and s_ in scope) or (c in scope)
            if in_scope:                                                      # 228 / 229
                rows.append((c, role, why, 'in scope', rf, rl))
            if rk == 'qualified' and s_ is not None and s_ not in scope:
                quals = _qualifiers(code, rf, rl, n)
                if tname and tname in quals:                                  # 231
                    rows.append((c, 'uses', 'writes/reads it', 'in scope', rf, rl))
                if n not in declares_of(s_):
                    # 233 — a qualifier that is neither the owner's type nor any other type nor `this`/`self`
                    if any(qn != tname and qn not in typenames and qn not in SELF_QUALIFIERS for qn in quals):
                        rows.append((c, 'uses', 'writes/reads it', 'by name', rf, rl))
                    if not quals:                                             # 235 — no qualifier on the line
                        rows.append((c, 'uses', 'writes/reads it', 'by name', rf, rl))
            if rk == 'bare':
                if s_ is not None and s_ not in scope and n not in declares_of(s_):   # 238
                    rows.append((c, 'reads', 'reads it', 'by name', rf, rl))
                if s_ is None and c not in scope:                              # 240
                    rows.append((c, 'reads', 'reads it', 'by name', rf, rl))
        # ── the accessors the convention gives the field, and their callers (242 / 243) ────────────────────
        for an, role_ in _accessors(n):
            ids_ = [a for (a, nm, _k) in by_tid.get(t, ()) if nm == an] if t else []
            if not ids_: continue
            aph = ','.join('?' * len(ids_))
            for c, f_, l_ in q(f"""SELECT e.caller_id, s.file_path, s.start_line
                                   FROM call_edges e LEFT JOIN call_sites s ON s.id=e.call_site_id
                                   WHERE e.callee_method_id IN ({aph}) AND e.callee_provenance='client'
                                   ORDER BY s.start_line""", *ids_):
                verb = 'reads' if role_ == 'read' else 'writes'
                rows.append((c, verb, f'{verb} it through {an}()', 'resolved', rel(f_) if f_ else '', l_ or 0))
            de += [(c, a) for c, a in q(f"""SELECT DISTINCT caller_id, callee_method_id FROM call_edges
                                            WHERE callee_method_id IN ({aph})
                                              AND callee_provenance='client'""", *ids_)]
        # ── 251: the name written in a string literal ──────────────────────────────────────────────────────
        if _has(q, 'literals'):
            for v, lf, ll in q("""SELECT value, file, line FROM literals
                                  WHERE value = ? AND length(value) < 64""", n):
                c = at(lf, ll)
                if c:
                    rows.append((c, 'uses',
                                 'names it in a string literal (serialization? a map key? a request key?)',
                                 'text', lf, ll))
        # ── 255 / 256: who constructs the owning type ──────────────────────────────────────────────────────
        if t and tname:
            ctors = [a for (a, _nm, k) in by_tid.get(t, ()) if k == 'constructor']
            if ctors:
                cph = ','.join('?' * len(ctors))
                for c, f_, l_ in q(f"""SELECT e.caller_id, s.file_path, s.start_line
                                       FROM call_edges e LEFT JOIN call_sites s ON s.id=e.call_site_id
                                       WHERE e.callee_method_id IN ({cph}) AND e.callee_provenance='client'
                                       ORDER BY s.start_line""", *ctors):
                    rows.append((c, 'produces', f'constructs {tname}', 'resolved',
                                 rel(f_) if f_ else '', l_ or 0))
                de += [(c, k) for c, k in q(f"""SELECT DISTINCT caller_id, callee_method_id FROM call_edges
                                                WHERE callee_method_id IN ({cph})
                                                  AND callee_provenance='client'""", *ctors)]
            for c, nm, k, f_, l_ in q("""SELECT s.caller_id, s.callee_name, s.kind, s.file_path, s.start_line
                                         FROM call_sites s JOIN unresolved_sites u ON u.call_site_id=s.id
                                         WHERE s.callee_name IS NOT NULL AND s.callee_name<>''"""):
                if (nm or '').split('.')[-1] == tname and k in CTOR_KINDS:
                    rows.append((c, 'produces', f'constructs {tname} (unresolved site)', 'by name',
                                 rel(f_) if f_ else '', l_ or 0))
            if _has(q, 'refs'):
                for rf, rl in q("""SELECT file, line FROM refs
                                   WHERE name=? AND kind='CLASS_LITERAL' AND line > 0""", tname):
                    c = at(rf, rl)
                    if c:
                        rows.append((c, 'produces',
                                     f'reflects on {tname}.class — deserialization or a framework produces it here',
                                     'by name', rf, rl))
            # 258-260: and the same for every type that HOLDS one — a new shape of the field has to be
            # produced wherever a holder is built, which is usually further out than the owner's constructors.
            hs = sorted(_holds(q, t, tname, lines))
            # one lookup for every holder, not one per holder: a common type is held by thousands (ObjectMapper
            # by 4,306 on jackson) and the per-id query alone was 4,306 round trips.
            hname = {}
            for i in range(0, len(hs), 500):
                chunk = hs[i:i + 500]
                for hid, hn in q(f"SELECT id, name FROM symbols WHERE id IN ({','.join('?' * len(chunk))})",
                                 *chunk):
                    if hn: hname[hid] = hn
            hctors = {h: [a for (a, _nm, k) in by_tid.get(h, ()) if k == 'constructor'] for h in hs}
            allc = [a for v in hctors.values() for a in v]
            # ONE pass over the site tables for ALL holders. Querying per holder re-scanned every call site in
            # the bundle once per holder — 30 holders on a jackson field took the query from 2 s to 32 s.
            site_of = {}
            if allc:
                aph = ','.join('?' * len(allc))
                for c, cal, f_, l_ in q(f"""SELECT e.caller_id, e.callee_method_id, s.file_path, s.start_line
                                            FROM call_edges e LEFT JOIN call_sites s ON s.id=e.call_site_id
                                            WHERE e.callee_method_id IN ({aph}) AND e.callee_provenance='client'
                                            ORDER BY s.start_line""", *allc):
                    site_of.setdefault(cal, []).append((c, f_, l_))
            hnames = set(hname.values())
            unres = {}
            if hnames:
                for c, nm, k, f_, l_ in q("""SELECT s.caller_id, s.callee_name, s.kind, s.file_path, s.start_line
                                             FROM call_sites s JOIN unresolved_sites u ON u.call_site_id=s.id
                                             WHERE s.callee_name IS NOT NULL AND s.callee_name<>''"""):
                    base = (nm or '').split('.')[-1]
                    if base in hnames and k in CTOR_KINDS: unres.setdefault(base, []).append((c, f_, l_))
            lits = {}
            if hnames and _has(q, 'refs'):
                nl = sorted(hnames); nph = ','.join('?' * len(nl))
                for nm, rf, rl in q(f"""SELECT name, file, line FROM refs
                                        WHERE name IN ({nph}) AND kind='CLASS_LITERAL' AND line > 0""", *nl):
                    lits.setdefault(nm, []).append((rf, rl))
            for h in hs:
                hn = hname.get(h)
                if not hn: continue
                for a in hctors[h]:
                    for c, f_, l_ in site_of.get(a, ()):
                        rows.append((c, 'produces', f'constructs {hn}, which holds {tname}', 'resolved',
                                     rel(f_) if f_ else '', l_ or 0))
                    de += [(c, a) for c, _f, _l in site_of.get(a, ())]
                for c, f_, l_ in unres.get(hn, ()):
                    rows.append((c, 'produces', f'constructs {hn}, which holds {tname} (unresolved site)',
                                 'by name', rel(f_) if f_ else '', l_ or 0))
                for rf, rl in lits.get(hn, ()):
                    c = at(rf, rl)
                    if c:
                        rows.append((c, 'produces',
                                     f'reflects on {hn}.class, which holds {tname} — deserialization '
                                     f'produces the value here', 'by name', rf, rl))
    return rows, de



def _holds(q, t, tname, lines):
    """`holds(h,t)`: type h has a FIELD whose type is t — a value of t is produced whenever an h is.

      152  a FIELD_TYPE type-reference naming t, attributed to a callable whose owner is h
      154  the type written on a field's own declaration line (`field_type`), naming the DECLARING type
      158  the file-scoped fallback, used ONLY where no field declaration in that file could be read at all

    `field_type` is keyed on the `f:<rowid>` form of the id always, while `field` uses the symbol's own id when
    it has one — so both 154 and `file_field_typed` only see fields with NO id of their own. Counting every field
    whose declaration line parses made `file_field_typed` true almost everywhere and suppressed 158, which is the
    leg that actually fires: on jackson it supplies all 30 holders of SettableBeanProperty and the other two
    supply none.
    """
    memb, owner_disp, _tf, tid_of, _bt = _members(q)
    out = set()
    if not (t and tname and _has(q, 'type_refs')): return out
    # 152 — the callable carrying the reference, through its owner
    for rf, rl in q("""SELECT file, line FROM type_refs
                       WHERE name=? AND context='FIELD_TYPE' AND line > 0""", tname):
        r = q("""SELECT owner FROM symbols WHERE file=? AND line<=? AND end_line>=?
                 AND method_id IS NOT NULL AND owner IS NOT NULL
                 ORDER BY (end_line-line) LIMIT 1""", rf, rl, rl)
        if r:
            h = tid_of.get(owner_disp(r[0][0]) or '')
            if h: out.add(h)

    def field_typed(ffile, fname, fline):
        """the `field_type` regex on the RAW line, which is what the exporter reads — `self.lines`, not the
        comment-and-string-blanked `self.code`. Using the blanked source was both wrong and the reason a query
        on a widely-held type took 32 s: blanking 537 candidate files dominated everything else."""
        L = lines(ffile)
        line = L[fline - 1] if 0 < fline <= len(L) else ''
        if not (fname and line): return None
        m = re.search(rf'([A-Za-z_$][\w$.]*)\s*(?:<[^;=]*>)?\s*(?:\[\s*\])*\s+{re.escape(fname)}\s*[;=,)]', line)
        if not m: m = re.search(rf'{re.escape(fname)}\s*:\s*([A-Za-z_$][\w$.]*)', line)
        return m.group(1).split('.')[-1] if m else None

    # 154 — only fields with no id of their own can join field_type
    for owner, fname, ffile, fline in q("""SELECT owner, name, file, line FROM symbols
                                           WHERE method_id IS NULL AND type_id IS NULL AND id IS NULL
                                           AND kind IN ('field','const','enum_member','variable')
                                           AND file IS NOT NULL AND line > 0"""):
        if field_typed(ffile, fname, fline) == tname and owner:
            h = tid_of.get(owner_disp(owner) or '')
            if h and h != t: out.add(h)
    # 158 — the file-scoped fallback, per candidate file only
    for (rf,) in q("""SELECT DISTINCT file FROM type_refs
                      WHERE name=? AND context='FIELD_TYPE' AND (line IS NULL OR line = 0)""", tname):
        typed = any(field_typed(ff, fn, fl)
                    for fn, ff, fl in q("""SELECT name, file, line FROM symbols
                                           WHERE file=? AND method_id IS NULL AND type_id IS NULL AND id IS NULL
                                           AND kind IN ('field','const','enum_member','variable') AND line > 0""",
                                        rf))
        if typed: continue                                            # !file_field_typed(f)
        for (h,) in q("""SELECT id FROM symbols WHERE file=?
                         AND ((type_id IS NOT NULL AND method_id IS NULL) OR kind='module')""", rf):
            if h != t: out.add(h)
    return out


def _accessors(n):
    """`accessor(fl,an,role)` — the names a convention would give this field, exactly as the exporter derives
    them: the bean pair, the fluent name, and the same name without a leading underscore."""
    cap = n[:1].upper() + n[1:]
    out = [('get' + cap, 'read'), ('is' + cap, 'read'), ('set' + cap, 'write'), (n, 'read')]
    if n.startswith('_') and len(n) > 1: out.append((n.lstrip('_'), 'read'))
    return out


def _qualifiers(code, f, l, n):
    """`qualifier(f,l,n,qn)` — what is written before `.n` on that line, from the blanked source."""
    L = code(f) if f else []
    text = L[l - 1] if 0 < l <= len(L) else ''
    return set(re.findall(rf'([A-Za-z_$][\w$]*)\s*\.\s*{re.escape(n)}\b', text))

def _same_file_members(q, own_tid, f):
    """`type_in_file(t,f), type_in_file(t2,f), t2 != t, callable_member(t2,c)` — the callables of the OTHER types
    declared in file f, yielded as (c, t2).

    Keyed on the type SYMBOL ID, because that is what the rule joins on, and the exporter builds its two maps
    from different row sets: `tid_of` from anything carrying a type_id (a method row can), `type_in_file` from
    the type rows only (method_id IS NULL) plus the module nodes. Keying this on the display instead moved 179
    rows off one keycloak target and pulled 168 others in.

    Iterating the symbols IN f is also not the same thing and loses rows: `member(t2,c)` resolves the owner
    display to ONE type id, first id wins, so a type in f owns every method written with that owner display —
    including ones in another file entirely. keycloak has two `AbstractOrganizationTest` classes in different
    modules, and 24 of the members the rules report for the one in f are written in the other.
    """
    _memb, _od, _tf, _tid, by_tid = _members(q)
    for (t2,) in q("""SELECT id FROM symbols WHERE file=?
                      AND ((type_id IS NOT NULL AND method_id IS NULL) OR kind='module')""", f):
        if t2 == own_tid: continue
        for (c, _n, _k) in by_tid.get(t2, ()):
            if _k in NON_CALLABLE_KINDS: continue     # callable_member(t2,c): k != field/const/enum_member/variable
            yield c, t2


def _alongside_for_type(q, tids, inside, target_fields=(), at=None):
    """`alongside` for a TYPE target, where `target_owner(q,t)` is the type itself.

    Two of the three alongside rules collapse here. `is_target_decl` has no rule for a type target, so
    `target_field` is empty, so `shares_field` is empty and no row is ever worded "…, using the same field X".
    And rule 329's siblings are the type's OWN callable members, every one of which is inside the type's span and
    therefore excluded by `!inside_target`. What is left in practice is rule 330: the callables of the OTHER
    types declared in the same file.
    """
    rows = []
    memb, owner_disp, tfile, tid_of, by_tid = _members(q)
    disp_of = {}
    for t in tids:
        r = q("SELECT display, file FROM symbols WHERE id=?", t)
        if r: disp_of[t] = (r[0][0], r[0][1])
    # shares_field(q,c,n) :- target_field(q,n), ref(c,n,_,ek,_,_), !local_kind(ek), callable_member(t,c)
    # `target_field` is empty for a TYPE target (is_target_decl has no rule for one) but is the field's own name
    # for a FIELD target, and rule 329 only emits the plain wording for a sibling that shares NOTHING. One row per
    # shared name, because shares_field is keyed on the field.
    shared = {}
    if target_fields and at is not None and _has(q, 'refs'):
        members = {c for t in tids for (c, _n, _k) in by_tid.get(t, ())}
        for nm in sorted(set(target_fields)):
            for rf, rl, ek in q("""SELECT file, line, entity_kind FROM refs
                                   WHERE name=? AND line > 0""", nm):
                if ek in LOCAL_KINDS: continue
                c = at(rf, rl)
                if c in members: shared.setdefault(c, set()).add(nm)
    for t in tids:                                            # 329 — kept because a member declared outside the
        for (c, _n, _k) in by_tid.get(t, ()):                 #       type's own span is not `inside_target`
            if _k in NON_CALLABLE_KINDS: continue             # callable_member(t,c): k != field/const/enum/variable
            if c in inside: continue
            if c in shared:
                for nm in sorted(shared[c]):
                    rows.append((c, 'uses', f'a sibling of the same type, using the same field {nm}',
                                 'alongside', '', 0))
            else:
                rows.append((c, 'uses', 'a sibling of the same type', 'alongside', '', 0))
    sib = {r[0] for r in rows}
    for t in tids:
        _o, f = disp_of.get(t, (None, None))
        if not f: continue
        for c, _t2 in _same_file_members(q, t, f):
            if c not in inside and c not in sib:
                rows.append((c, 'uses', 'declared in the same file', 'alongside', '', 0))
    return rows


def _declines_type(q, tids):
    """True when a TYPE target needs a rule this does not derive from the bundle, so the query goes to Soufflé.

    Three of the type rules read relations the exporter builds by scanning source text rather than by reading a
    table, and those are the only ones not ported:

      343  switches over the enum (n of its constants named)   — `switch_over`, regex over each callable's body
      397  re-exports it (a barrel)                            — `reexport`, regex over each JS/TS module
      276  calls the generated getter/setter                   — `gen`, the convention table over decorations

    Declining is not a silent wrong answer: the rules run and the user gets the same output, a little slower.
    """
    ph = ','.join('?' * len(tids))
    # 343 (`switch_over`) used to decline here; it is derived now, so an enum is answered like any other type.
    # `gen(t,"fluent_read")` and `gen(t,"ctor")` hold for a RECORD with no decoration at all — the shape
    # alone generates the accessors. 72 `reads it through the generated accessor name()` rows on one
    # record field, and nothing in `decorations` to see it by.
    if q(f"SELECT 1 FROM symbols WHERE id IN ({ph}) AND kind='record' LIMIT 1", *tids): return True
    if _has(q, 'types') and q(f"SELECT 1 FROM types WHERE id IN ({ph}) "
                              f"AND category LIKE '%RECORD%' LIMIT 1", *tids): return True
    # 397: a barrel is a JS/TS construct; a bundle with no such module can have no reexport row
    if q("SELECT 1 FROM symbols WHERE kind='module' AND (file LIKE '%.ts' OR file LIKE '%.tsx' OR file LIKE '%.js'"
         " OR file LIKE '%.jsx' OR file LIKE '%.mjs' OR file LIKE '%.cjs') LIMIT 1"): return True
    # 276/277 — `gen(t,w)`, which has five sources. A decoration on the type, on an ancestor or on one of its
    # fields; a BASE CLASS whose written name is in the table (`class User(BaseModel)` — the base is usually a
    # library type `extends` never resolved, so only the written name sees it); and `gen_alias`, a project-local
    # decorator whose own body calls a generator.
    if _has(q, 'decorations'):
        fam = set(tids)
        if _has(q, 'type_ancestors'):
            fam |= {r[0] for r in q(f"SELECT ancestor_type_id FROM type_ancestors WHERE type_id IN ({ph})", *tids)}
        fph = ','.join('?' * len(fam))
        owners = set(fam) | {r[0] for r in q(f"SELECT id FROM symbols WHERE owner IN "
                                             f"(SELECT display FROM symbols WHERE id IN ({fph}))", *fam)}
        oph = ','.join('?' * len(owners))
        decs = {(nm or '').split('.')[-1]
                for (nm,) in q(f"SELECT name FROM decorations WHERE owner_id IN ({oph})", *owners)}
        if decs & GEN_DECOR: return True
        # gen_alias(d,w) :- named(d,m), ref(m,g,…), gen_table(g,w) — the alias is recognised by what the
        # decorator's own body calls, which is a source read. A decoration naming a declaration IN THIS PROJECT
        # could be one; a library annotation (@Override, @Test) declares nothing here and cannot be.
        for d in sorted(decs - GEN_DECOR):
            # `named(d,m)` is METHODS only — an annotation TYPE of that name is not a candidate. Matching any
            # symbol declined `@JacksonStdImpl` and `@JsonPOJOBuilder`, which generate nothing, and took jackson
            # field coverage down to 4 of 14.
            for m, mf, ml, me in q("""SELECT id, file, line, end_line FROM symbols
                                      WHERE name=? AND method_id IS NOT NULL AND kind<>'module'
                                      AND file IS NOT NULL AND line > 0""", d):
                # ref(m,g,…), gen_table(g,_): the decorator's own body names a generator
                if _has(q, 'refs') and q("""SELECT 1 FROM refs WHERE file=? AND line BETWEEN ? AND ?
                                            AND name IN ({}) LIMIT 1""".format(','.join('?' * len(GEN_DECOR))),
                                         mf, ml, me or ml, *sorted(GEN_DECOR)):
                    return True
    # `base_name(t,n)`: the supertype as WRITTEN. Checked per file rather than per span — broader than the rule,
    # which costs a fallback on a file that happens to hold such a base, never a wrong answer.
    if _has(q, 'type_refs'):
        for f, ln, en in q(f"SELECT file, line, end_line FROM symbols WHERE id IN ({ph})", *tids):
            if not f: continue
            for nm, trl in q(BASE_REF_SQL, f):
                if (nm or '').split('.')[-1] not in GEN_DECOR: continue
                # the exporter resolves a base-class reference WITH a line through type_at — the nearest
                # enclosing type — and only a LINELESS one falls back to every type in the file. Testing the
                # whole file either way declined any file that merely contains a class called `Builder`.
                if not trl: return True
                if ln and en and ln <= trl <= en: return True
    return False


def _throws_catches(code, f, ln, en):
    """`throws_(m,e)` and `catches(m,e)` for ONE callable, read from its own text.

    Java records a throws clause with no line and (#760) mislabels switch arms, so the exporter reads both from
    the callable's source — the same source the [text] certainty already trusts — and these are the identical
    expressions. `code` hands back the file with comments and string literals blanked, so a name in a javadoc or
    a string is not a use.

    The exporter scans every symbol in the bundle once (6,402 rows on jackson) because the rules need the whole
    relation; a query needs it only for the target and the target's own callers, which is far less work.
    """
    L = code(f) if f else []
    a = ln or 0
    if not a or a > len(L): return set(), set()
    b = min(en or a, len(L))
    head = ' '.join(L[a - 1:min(b, a + 8)]).split('{')[0]
    thr = {e for m in re.finditer(r'\bthrows\s+([\w.,\s]+)', head)
           for e in re.findall(r'[A-Z][\w$]*', m.group(1))}
    body = '\n'.join(L[a - 1:b])
    cat = {x for e in re.findall(r'\bcatch\s*\(\s*(?:final\s+)?([\w.|\s]+?)\s+\w+\s*\)', body)
           for x in re.findall(r'[A-Z][\w$]*', e)}
    return thr, cat


def solve_from_targets(q, T, QS, site_file=None, nonsource=(), code=None, at=None,
                       inside=(), textuse=(), importuse=(), lines=None):
    """Return exactly what Impact.run() returns — {relation: [row…, query_id]} — or None to fall back.

    T is the target relation: (query_id, kind, symbol_id, extra). Only method targets are answered here; a
    config key, a field, a type or a decoration still goes to the rules, which carry their own ~20 cases.

    Every relation this does not derive is returned empty, which is what the rules return for a method target
    anyway: on sampled targets extbind, gen_fired, caller_handles, caller_unhandled, target_throws and
    inherited_test had no rows.
    """
    if not T or any(k not in SOLVE_KINDS for _, k, _, _ in T): return None
    tys = {s_ for _r, k, s_, _x in T if k == 'type'}
    flds = {s_ for _r, k, s_, _x in T if k == 'field'}
    ncs = {s_ for _r, k, s_, _x in T if k == 'newconst'}
    if (tys or flds) and at is None: return None
    if flds and lines is None: return None
    # `switch_over` is read from each callable's own text, so an enum target — or a field of one — needs the
    # source accessor
    if (ncs or tys or flds) and code is None: return None
    if tys and _declines_type(q, tys): return None
    if flds:
        # a FIELD reaches gen (245-249), switch_over (344) and reexport (396) through its owner type, so it
        # declines on exactly the same tests — `gen(t,"get")` is what turns a field into its generated accessors.
        owners = {r[0] for r in (field_rec(q, f_) for f_ in flds) if r and r[0]}
        if not owners or _declines_type(q, sorted(owners)): return None
    # a call site's file as the REPO sees it: Java bundles store absolute paths and the index's `paths` table maps
    # them. Without this the answer prints the machine's absolute path where the rules print src/main/java/…
    rel = site_file or (lambda x: x)
    out = {k: [] for k in ('contract', 'direct', 'direct_edge', 'seed', 'seed_byname', 'reach', 'reach_sure',
                           'parent_up', 'test_near', 'test_hit', 'inherited_test', 'extbind', 'gen_fired',
                           'caller_handles', 'caller_unhandled', 'target_throws')}
    E = _edges(q); rev = _rev(E); sets = _test_sets(q, lines)
    for qq in QS:
        # A query can carry SEVERAL target kinds at once: a name match that hits both a method and a field
        # resolves to both, and the rules simply union what each kind derives. Dispatch per kind and union here
        # too — testing `any(kind == 'type')` and taking one branch drops the other kind's rows entirely.
        mine = [(k, s_, x) for r, k, s_, x in T if r == qq]
        if not mine: continue
        # `target(q,k,s,x)`: a STRING target is written (q,"string","",value) — no symbol at all — so the ids and
        # the extras are kept apart rather than one standing in for the other.
        ids = sorted({s_ for _k, s_, _x in mine if s_})
        by_kind, extra = {}, {}
        for k, s_, x in mine:
            if s_: by_kind.setdefault(k, set()).add(s_)
            if x: extra.setdefault(k, set()).add(x)
        kinds = {k for k, _s, _x in mine}
        if not ids and not extra: continue
        ph = ','.join('?' * len(ids)) if ids else "''" 
        con, dr, seeds, de, byname = [], [], set(), [], []
        ins = {c for r, c in inside if r == qq}

        if 'method' in by_kind:
            mids = sorted(by_kind['method'])
            mph = ','.join('?' * len(mids))
            con += contract_for_method(q, mids)
            d = direct_for_method(q, mids)
            dr += d
            # seed_of(q,m) for a method target is the target and what the contract binds to it
            seeds |= set(mids) | {c for c, _ in con}
            de += q(f"""SELECT DISTINCT caller_id, callee_method_id FROM call_edges
                        WHERE callee_method_id IN ({mph}) AND callee_provenance='client'""", *mids)
            byname = sorted({c for c, _r, _w, cert, _f, _l in d if cert == 'by name'} - seeds)

        if 'type' in by_kind:
            tids = sorted(by_kind['type'])
            tph = ','.join('?' * len(tids))
            # contract(q,s,"extends / implements it") :- extends(s,t) — the subtypes, which is the whole point of
            # asking about a type: a change to it is a change to everything that extends or implements it.
            tcon = sorted({(r[0], 'extends / implements it') for r in q(
                f"SELECT type_id FROM type_ancestors WHERE ancestor_type_id IN ({tph})", *tids)}) \
                if _has(q, 'type_ancestors') else []
            con += tcon
            d = direct_for_type(q, tids, at, ins, textuse, importuse, rel, code)
            # alongside, through target_owner(q,t) :- target(q,"type",t,_) — the type IS its own owner here
            d += _alongside_for_type(q, tids, ins)
            dr += d
            _memb, _od, _tf, _tid, by_tid = _members(q)
            mem = [(m, n, k) for t in tids for (m, n, k) in by_tid.get(t, ())]
            # seed_of: the type's own callable members (373), the type node itself (374), every non-alongside
            # direct row (376) and everything the contract binds (378)
            seeds |= (set(tids)
                      | {m for m, _n, k in mem if k in ('method', 'constructor', 'function', 'module')}
                      | {c for c, _r, _w, cert, _f, _l in d if cert != 'alongside'}
                      | {c for c, _ in tcon})
            # direct_edge(q,c,m) :- tmember(q,m,_,_), calls(c,m,_,_,_)
            memids = [m for m, _n, _k in mem]
            if memids:
                de += q(f"""SELECT DISTINCT caller_id, callee_method_id FROM call_edges
                            WHERE callee_method_id IN ({','.join('?' * len(memids))})
                              AND callee_provenance='client'""", *memids)
        if 'field' in by_kind:
            fids = sorted(by_kind['field'])
            d, fde = direct_for_field(q, fids, at, code, lines, ins, rel)
            # alongside, through target_owner(q,t) :- target(q,"field",fl,_), field(fl,t,_,_,_)
            ftypes = set()
            for f_ in fids:
                r = field_rec(q, f_)
                if r and r[0]: ftypes.add(r[0])
            fnames = {r[1] for r in (field_rec(q, f_) for f_ in fids) if r and r[1]}
            if ftypes:
                d += _alongside_for_type(q, sorted(ftypes), ins, fnames, at)
            # rule 344 — the same switches as rule 343, reached through the field's OWNER when that owner is an
            # enum: a constant is what a switch arm names, so its dependents are the switches over the enum.
            if code is not None and ftypes:
                eids = [t for (t,) in q("SELECT id FROM symbols WHERE kind='enum' AND id IN ({})".format(
                    ','.join('?' * len(ftypes))), *sorted(ftypes))]
                if eids:
                    esw = switch_over(q, eids, code)
                    for t in eids:
                        for c, arms in esw.get(t, ()):
                            if c in ins: continue
                            d.append((c, 'uses', f'switches over the enum ({arms} of its constants named)',
                                      'resolved', '', 0))
            dr += d
            de += fde
            # seed_of(q,t) :- target(q,"field",fl,_), field(fl,t,_,_,_)  (372), plus the generic rule 376:
            # every non-alongside direct row is a seed for a target kind that is not method/param/var
            seeds |= ftypes | {c for c, _r, _w, cert, _f, _l in d if cert != 'alongside'}

        if 'decoration' in kinds:
            dids = sorted(by_kind.get('decoration', ()))
            d = direct_for_decoration(q, dids)
            dr += d
            # seed_of(q,m) :- target(q,"decoration",m,_)   (368), plus the generic rule 376 over the direct rows.
            # There is no target_owner for a decoration, so no `alongside` tier exists for it at all.
            seeds |= set(dids) | {c for c, _r, _w, cert, _f, _l in d if cert != 'alongside'}

        if 'newconst' in kinds:
            nids = sorted(by_kind.get('newconst', ()))
            d, switchers = direct_for_newconst(q, nids, code, ins)
            # alongside, through target_owner(q,t) :- target(q,"newconst",t,_) — the enum IS its own owner here
            d += _alongside_for_type(q, nids, ins)
            dr += d
            # seed_of(q,t) (369), seed_of(q,c) :- switch_over(c,t,_) (370), plus the generic rule 376
            seeds |= set(nids) | switchers | {c for c, _r, _w, cert, _f, _l in d if cert != 'alongside'}

        if 'config' in kinds:
            d, readers = direct_for_config(q, set(by_kind.get('config', ())), at, rel)
            dr += d
            # seed_of(q,m) :- target(q,"config",k,_), config(k,m,_)   (371), plus the generic rule 376
            seeds |= readers | {c for c, _r, _w, cert, _f, _l in d if cert != 'alongside'}

        if 'string' in kinds:
            d = direct_for_string(q, extra.get('string', set()), at, rel)
            dr += d
            # seed_of(q,c) :- target(q,"string",_,_), direct(q,c,…,cert,…), cert != "alongside"   (403)
            seeds |= {c for c, _r, _w, cert, _f, _l in d if cert != 'alongside'}
        seeds = sorted(seeds)
        out['contract'] += [[c, why, qq] for c, why in con]
        # a Soufflé relation is a SET. Two call_edges rows for the same caller, member and site — different
        # tiers, or a site the engine recorded twice — collapse to one `direct` row there and to two here, and
        # the answer counts them: `sites: 2` where the rules say `sites: 1`. Deduped first-seen so the site
        # ordering the rows carry is untouched.
        _seen = set(); _dr = []
        for r in dr:
            if r in _seen: continue
            _seen.add(r); _dr.append(r)
        dr = _dr
        out['direct'] += [[c, role, why, cert, (rel(f) if f else ''), str(l), qq] for c, role, why, cert, f, l in dr]
        out['seed'] += [[m, qq] for m in seeds]
        # direct_edge is a SET too. The holds legs append one pair per CALL SITE, so a caller that builds the
        # same holder twice appeared twice — the duplicate check in the parity harness is what found it.
        _sde = set(); _de = []
        for c, m in de:
            if (c, m) in _sde: continue
            _sde.add((c, m)); _de.append((c, m))
        out['direct_edge'] += [[c, m, qq] for c, m in _de]
        out['seed_byname'] += [[c, qq] for c in byname]
        depth = reach_from(rev, seeds, byname)
        out['reach'] += [[m, str(d), qq] for m, d in depth.items()]
        # reach_sure: the same closure from the seeds that are an exact edge only — a seed reached ONLY through a
        # by-name / text / one-of-a-set dependent is weak, and the answer says how much of itself rests on those
        strong = {c for c, _r, _w, cert, _f, _l in dr if cert in ('resolved', 'in scope')}
        weak = {c for c, _r, _w, cert, _f, _l in dr if cert in ('by name', 'text', 'one of a set')} - strong
        out['reach_sure'] += [[m, qq] for m in reach_from(rev, [m for m in seeds if m not in weak])]
        out['parent_up'] += [[a, b, t, qq] for a, b, t in parent_up(E, depth)]
        # a Soufflé relation comes out of `.output` in its own B-tree order, which for test_hit(q,m,d,via) is
        # lexicographic on (q,m,d,via) with d NUMERIC. `hits` is a set, so without this the row order is not even
        # stable between two runs of the same query, and the answer's test list came out shuffled against the
        # rules' — same set, different order, which a byte comparison calls a disagreement.
        hits = sorted(tests_reaching(q, depth, sets, every=True), key=lambda r: (r[0], r[1], r[2]))
        out['test_hit'] += [[m, str(d), via, qq] for m, d, via in hits]
        out['inherited_test'] += [[s_, m, str(d), qq] for s_, m, d in inherited_tests(q, hits)]
        # extbind: the target's name written in a NON-SOURCE file — an XSD, a template, a config. Nothing in the
        # graph carries these; run() regex-scans the tree for them and hands the hits over.
        #   extbind(q,f,l,n,"names the method")         :- target(q,"method",m,_), named(n,m),      nonsource(n,f,l)
        #   extbind(q,f,l,n,"names the method in full") :- target(q,"method",m,_), qual_name(m,n),  nonsource(n,f,l)
        if nonsource:
            #   method: extbind(…,"names the method")      :- named(n,m), nonsource(n,f,l)
            #           extbind(…,"names the method in full") :- qual_name(m,n), nonsource(n,f,l)
            #   type:   the same pair over typ(t,n,_) and the type's qualified name
            # Built per KIND, not once over every id: a query carrying both a method and a type would otherwise
            # word one of them after the other.
            simple, full = {}, {}
            for kind, kids in (('method', by_kind.get('method')), ('type', by_kind.get('type')),
                               ('field', by_kind.get('field'))):
                if not kids: continue
                kph = ','.join('?' * len(kids)); kl = sorted(kids)
                if kind == 'field':
                    # extbind(…,"names the field") :- field(fl,_,n,_,_), nonsource(n,f,l) — no "in full" form
                    for f_ in kl:
                        r = field_rec(q, f_)
                        if r and r[1]: simple.setdefault(r[1], 'field')
                    continue
                for (n,) in q(f"SELECT name FROM symbols WHERE id IN ({kph})", *kl):
                    if n: simple.setdefault(n, kind)
                if kind == 'method':
                    # `qual_name(m,n)` for a METHOD is the DISPLAY (`SequenceWriter.writeAll`), not the fully
                    # qualified name — that is what the exporter appends, and what a CREDITS file or an XSD writes.
                    for (d,) in q(f"SELECT display FROM symbols WHERE id IN ({kph})", *kl):
                        if d: full.setdefault(d, kind)
                else:
                    # for a TYPE it is both the qualified name and the display, where either differs from the name
                    for qn, d, n in q(f"SELECT qualified_name, display, name FROM symbols WHERE id IN ({kph})", *kl):
                        for x in (qn, d):
                            if x and x != n: full.setdefault(x, kind)
            #   config: extbind(…,"defines or overrides the key") :- nonsource(n,f,l), n = k   (473)
            ckeys = by_kind.get('config') or set()
            for n, f, l in nonsource:
                if n in ckeys: out['extbind'].append([f, str(l), n, 'defines or overrides the key', qq])
                elif n in simple: out['extbind'].append([f, str(l), n, f'names the {simple[n]}', qq])
                elif n in full: out['extbind'].append([f, str(l), n, f'names the {full[n]} in full', qq])
        # ── the throws contract ────────────────────────────────────────────────────────────────────────────
        #   target_throws(q,e)      :- target(q,"method",m,_), throws_(m,e)
        #   caller_handles(q,c,e)   :- throws_(m,e), calls(c,m,_,_,_), (throws_(c,e) ; catches(c,e))
        #   caller_unhandled(q,c,e) :- throws_(m,e), calls(c,m,_,_,_), !caller_handles(q,c,e)
        # Only the human-readable output prints this, never --json, so a parity harness that compares --json
        # cannot see it missing — it was empty here while the rules gave 2 and 22 rows on the first method that
        # declares a `throws` at all.
        if code is not None and 'method' in kinds:
            tthrows = set()
            for f, ln, en in q(f"SELECT file, line, end_line FROM symbols WHERE id IN ({ph})", *ids):
                tthrows |= _throws_catches(code, f, ln, en)[0]
            out['target_throws'] += [[e, qq] for e in sorted(tthrows)]
            if tthrows:
                callers = sorted({c for (c,) in q(
                    f"""SELECT DISTINCT caller_id FROM call_edges
                         WHERE callee_method_id IN ({ph}) AND callee_provenance='client'""", *ids)})
                cph = ','.join('?' * len(callers)) if callers else "''"
                span = {r[0]: (r[1], r[2], r[3]) for r in q(
                    f"SELECT id, file, line, end_line FROM symbols WHERE id IN ({cph})", *callers)} if callers else {}
                for c in callers:
                    f, ln, en = span.get(c, (None, None, None))
                    ct, cc = _throws_catches(code, f, ln, en)
                    for e in sorted(tthrows):
                        if e in ct or e in cc: out['caller_handles'].append([c, e, qq])
                        else: out['caller_unhandled'].append([c, e, qq])
        th = tests_reaching(q, depth, sets)
        out['test_near'] += [[m, str(d), qq] for m, (d, _v) in sorted(th.items(), key=lambda r: (r[0], r[1][0]))]
    out['_targets'] = QS
    return out


# ── path.dl / path-opt.dl / path-every.dl, in SQL ────────────────────────────────────────────────────────────
# Same three answers, same shape as run_dl() returns, with no .facts written and no Soufflé process. The closures
# are walked a LEVEL at a time against an indexed in-memory table, never a query per node: one statement per hop
# (chunked only because SQLite caps host variables), and `parent` is a single set-based join, not a lookup per
# reached method. `dist` is the MINIMUM hop count a node is found at, which is why this is a level walk and not one
# recursive CTE — a CTE that UNIONs on (id, depth) keeps every depth and then needs a second pass to take the min.
PATH_DDL = """
CREATE TABLE edge(a TEXT, b TEXT, t TEXT);
CREATE TABLE src(q TEXT, m TEXT);
CREATE TABLE dst(q TEXT, m TEXT);
CREATE TABLE byname(c TEXT, n TEXT);
CREATE TABLE named(n TEXT, m TEXT);
"""
PATH_IDX = """
CREATE INDEX e_a ON edge(a); CREATE INDEX e_b ON edge(b);
CREATE INDEX s_q ON src(q); CREATE INDEX d_q ON dst(q);
CREATE INDEX bn_c ON byname(c); CREATE INDEX nm_n ON named(n);
"""
CHUNK = 400


def _level_walk(cur, seeds, table, cap):
    """{node: shortest hop count} from seeds, following `table` forward (a->b). One query per hop."""
    depth = {m: 0 for m in seeds}
    frontier, d = list(depth), 0
    while frontier and d < cap:
        nxt = []
        for i in range(0, len(frontier), CHUNK):
            chunk = frontier[i:i + CHUNK]
            ph = ','.join('?' * len(chunk))
            for (b,) in cur.execute(f"SELECT DISTINCT b FROM {table} WHERE a IN ({ph})", chunk):
                if b not in depth: depth[b] = d + 1; nxt.append(b)
        frontier = nxt; d += 1
    return depth


def _level_walk_up(cur, seeds, table, cap):
    """the same walk backwards (b->a): everything that reaches a seed, at its shortest hop count."""
    depth = {m: 0 for m in seeds}
    frontier, d = list(depth), 0
    while frontier and d < cap:
        nxt = []
        for i in range(0, len(frontier), CHUNK):
            chunk = frontier[i:i + CHUNK]
            ph = ','.join('?' * len(chunk))
            for (a,) in cur.execute(f"SELECT DISTINCT a FROM {table} WHERE b IN ({ph})", chunk):
                if a not in depth: depth[a] = d + 1; nxt.append(a)
        frontier = nxt; d += 1
    return depth


def _parent_rows(cur, dist, table):
    """parent(b,a,t) :- dist(b,d), d>0, dist(a,d-1), edge(a,b,t) — one join over a temp table, not a query per node."""
    cur.execute("DROP TABLE IF EXISTS _d"); cur.execute("CREATE TEMP TABLE _d(m TEXT PRIMARY KEY, d INT)")
    cur.executemany("INSERT OR REPLACE INTO _d VALUES(?,?)", list(dist.items()))
    cur.execute("CREATE INDEX IF NOT EXISTS _d_d ON _d(d)")
    return [(b, a, t) for b, a, t in cur.execute(
        f"SELECT DISTINCT db.m, da.m, e.t FROM _d db JOIN {table} e ON e.b = db.m JOIN _d da ON da.m = e.a AND da.d = db.d - 1 WHERE db.d > 0")]


def solve_path(rows, queries, every=False, opt=False, cap=MAX_HOP):
    """rows: {'edge': [(a,b,t)…], 'byname': [(c,n)…], 'named': [(n,m)…]}. queries: {q: (src_ids, dst_ids)}.
    Returns exactly what run_dl() returns, so the driver cannot tell which engine answered."""
    con = sqlite3.connect(':memory:'); cur = con.cursor()
    cur.executescript(PATH_DDL)
    cur.executemany("INSERT INTO edge VALUES(?,?,?)", rows.get('edge', ()))
    if opt:
        cur.executemany("INSERT INTO byname VALUES(?,?)", rows.get('byname', ()))
        cur.executemany("INSERT INTO named VALUES(?,?)", rows.get('named', ()))
    # only the indices this question needs. On a 107k-edge bundle each one is a measurable share of a query that
    # Soufflé answers in a third of a second, and a single-endpoint query uses exactly one direction.
    need_fwd = any(s for s, _ in queries.values()) or every
    need_up = any(d for _, d in queries.values()) or every
    if need_fwd: cur.execute("CREATE INDEX e_a ON edge(a)")
    if need_up: cur.execute("CREATE INDEX e_b ON edge(b)")
    if opt:
        cur.execute("CREATE INDEX bn_c ON byname(c)"); cur.execute("CREATE INDEX nm_n ON named(n)")
    if opt:
        # edge_opt(a,b,t) :- edge(a,b,t).  edge_opt(c,m,"by-name") :- byname(c,n), named(n,m).
        cur.execute("CREATE TABLE edge_opt(a TEXT, b TEXT, t TEXT)")
        cur.execute("INSERT INTO edge_opt SELECT a, b, t FROM edge")
        cur.execute("INSERT INTO edge_opt SELECT DISTINCT b.c, n.m, 'by-name' FROM byname b JOIN named n ON n.n = b.n")
        cur.execute("CREATE INDEX eo_a ON edge_opt(a)"); cur.execute("CREATE INDEX eo_b ON edge_opt(b)")
    out = {n: collections.defaultdict(list) for n in ('hit', 'parent', 'hit_opt', 'parent_opt', 'between_edge', 'dist_up', 'dist')}
    for q, (s, d) in queries.items():
        s, dset = list(s), set(d)
        fwd = _level_walk(cur, s, 'edge', cap) if s else {}
        out['dist'][q] = [(m, str(x)) for m, x in fwd.items()]
        out['hit'][q] = [(m, str(fwd[m])) for m in dset if m in fwd]
        if out['hit'][q]: out['parent'][q] = _parent_rows(cur, fwd, 'edge')
        up = _level_walk_up(cur, list(dset), 'edge', cap) if dset else {}
        out['dist_up'][q] = [(m, str(x)) for m, x in up.items()]
        if opt and s:
            fo = _level_walk(cur, s, 'edge_opt', cap)
            out['hit_opt'][q] = [(m, str(fo[m])) for m in dset if m in fo]
            if out['hit_opt'][q]: out['parent_opt'][q] = _parent_rows(cur, fo, 'edge_opt')
        if every:
            # between(m) :- fwd(m), bwd(m) — both closures uncapped, as the rules are, then the edges among them
            f_all = _level_walk(cur, s, 'edge', 10 ** 9)
            b_all = _level_walk_up(cur, list(dset), 'edge', 10 ** 9)
            btw = f_all.keys() & b_all.keys()
            cur.execute("DROP TABLE IF EXISTS _b"); cur.execute("CREATE TEMP TABLE _b(m TEXT PRIMARY KEY)")
            cur.executemany("INSERT OR REPLACE INTO _b VALUES(?)", [(m,) for m in btw])
            out['between_edge'][q] = [(a, b, t) for a, b, t in cur.execute(
                "SELECT DISTINCT e.a, e.b, e.t FROM edge e JOIN _b x ON x.m = e.a JOIN _b y ON y.m = e.b")]
    con.close()
    return out
