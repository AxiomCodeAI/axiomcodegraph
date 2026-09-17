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
import os, sqlite3, json

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


def _test_sets(q):
    """test_method and fixture, the same two sets the exporter builds — the distinction the whole test layer rests on.

    A TEST is is_test, a method or function, and either carries a @Test-shaped decoration or is named test*/it*.
    A helper in a test file (`_assertAsBigInteger`) is neither, so it is not a test: it is a CARRIER, and the tests
    it brings are the ones declared beside it. Counting every is_test callable as a test returned the helpers and
    lost the seven @Test methods they carry.
    A FIXTURE is a test type, a constructor or module, a known setUp name, or a Before*/fixture/setup* decoration.
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
    owner_id, file_of, kind_of = {}, {}, {}
    for sid, f, knd, tid, mid, owner, disp in q("SELECT id, file, kind, type_id, method_id, owner, display FROM symbols"):
        file_of[sid] = f; kind_of[sid] = knd
        if owner and owner in tid_of: owner_id[sid] = tid_of[owner]
        if tid and not mid: owner_id.setdefault(sid, tid_of.get(disp, sid))
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
            o = owner_id.get(sid)
            for key in ([o] + subs.get(o, [])) if o else []:
                for m in tests_by_owner.get(key, ()): put(m, d, sid)
        if sid not in tm and (kind_of.get(sid) in ('class', 'module') or sid in fx or file_of.get(sid) in test_files):
            for m in tests_by_file.get(file_of.get(sid), ()): put(m, d, sid)
    return rows if every else out


def _has(q, table):
    try: return bool(q("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", table))
    except Exception: return False


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
    for c, tier, f, l in q(f"""SELECT e.caller_id, e.tier, s.file_path, s.start_line
                               FROM call_edges e LEFT JOIN call_sites s ON s.id=e.call_site_id
                               WHERE e.callee_method_id IN ({ph}) AND e.callee_provenance='client'
                               ORDER BY s.start_line""", *ids):
        rows.append((c, 'uses', 'calls it',
                     'one of a set' if tier == 'multi_inferred' else 'resolved', f or '', l or 0))
    names = {r[0] for r in q(f"SELECT name FROM symbols WHERE id IN ({ph})", *ids) if r[0]}
    seen = {r[0] for r in rows}
    for n in names:
        for c, f, l, kind in q("""SELECT s.caller_id, s.file_path, s.start_line, s.kind FROM call_sites s
                                  JOIN unresolved_sites u ON u.call_site_id=s.id WHERE s.callee_name=?""", n):
            if kind in ('new', 'anon_new', 'CONSTRUCTOR_CALL'): continue      # !ctor_kind(k)
            rows.append((c, 'uses', 'calls a method of this name (receiver not typed)', 'by name', f or '', l or 0))
    # alongside: siblings of the target's own type, then the other types declared in the same file
    owners = {r[0] for r in q(f"SELECT owner FROM symbols WHERE id IN ({ph})", *ids) if r[0]}
    for o in owners:
        for (c,) in q("SELECT id FROM symbols WHERE owner=? AND method_id IS NOT NULL", o):
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
        spans = {}
        for o in owners:
            for (f,) in q("SELECT file FROM symbols WHERE display=? AND type_id IS NOT NULL AND file IS NOT NULL LIMIT 1", o):
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
        for (f,) in q("SELECT file FROM symbols WHERE display=? AND type_id IS NOT NULL AND file IS NOT NULL LIMIT 1", o):
            for c, c_owner in q("""SELECT s.id, s.owner FROM symbols s WHERE s.file=? AND s.method_id IS NOT NULL
                                   AND s.owner IS NOT NULL AND s.owner<>?""", f, o):
                if _owner_file(q, c_owner) != f: continue
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


_OWNER_FILE = {}
def _owner_file(q, disp):
    """the file of the type a DISPLAY resolves to — first id wins, as the exporter's tid_of does."""
    if disp not in _OWNER_FILE:
        r = q("SELECT file FROM symbols WHERE display=? AND type_id IS NOT NULL LIMIT 1", disp)
        _OWNER_FILE[disp] = r[0][0] if r else None
    return _OWNER_FILE[disp]


def contract_for_method(q, ids):
    """contract(q,c,why) for a method target: `overrides it` / `it overrides this`, the target never itself."""
    ph = ','.join('?' * len(ids))
    out = []
    for (o,) in q(f"SELECT overriding_method_id FROM overrides WHERE method_id IN ({ph})", *ids):
        if o not in ids: out.append((o, 'overrides it'))
    for (b,) in q(f"SELECT method_id FROM overrides WHERE overriding_method_id IN ({ph})", *ids):
        if b not in ids: out.append((b, 'it overrides this'))
    return sorted(set(out))                       # a set, for the same reason


# ── solve: the dict `Impact.run()` returns, without the .facts round trip ─────────────────────────────────────

SOLVE_KINDS = {'method'}     # the kinds answered here; anything else falls back to the rules

def inherited_tests(q, hits):
    """`inherited_test(q,s,m,d) :- test_hit(q,m,d,_), owner(m,t), extends(s,t), typ(s,_,_), s != t` — the test
    classes that extend a class whose test was reached run that test too, in their own file."""
    if not hits: return []
    # the owner resolved the way the exporter does — through {display: type_id} with setdefault, first id wins —
    # not through methods.owner_type_id. The real id is more precise and gives 475 inheriting classes where the
    # rules give 458; see the note in tests_reaching.
    tid_of = {}
    for disp, tid in q("SELECT display, type_id FROM symbols WHERE type_id IS NOT NULL"): tid_of.setdefault(disp, tid)
    owner_id = {sid: tid_of[owner] for sid, owner in q("SELECT id, owner FROM symbols WHERE owner IS NOT NULL")
                if owner in tid_of}
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


def solve_from_targets(q, T, QS, site_file=None, nonsource=()):
    """Return exactly what Impact.run() returns — {relation: [row…, query_id]} — or None to fall back.

    T is the target relation: (query_id, kind, symbol_id, extra). Only method targets are answered here; a
    config key, a field, a type or a decoration still goes to the rules, which carry their own ~20 cases.

    Every relation this does not derive is returned empty, which is what the rules return for a method target
    anyway: on sampled targets extbind, gen_fired, caller_handles, caller_unhandled, target_throws and
    inherited_test had no rows.
    """
    if not T or any(k not in SOLVE_KINDS for _, k, _, _ in T): return None
    # a call site's file as the REPO sees it: Java bundles store absolute paths and the index's `paths` table maps
    # them. Without this the answer prints the machine's absolute path where the rules print src/main/java/…
    rel = site_file or (lambda x: x)
    out = {k: [] for k in ('contract', 'direct', 'direct_edge', 'seed', 'seed_byname', 'reach', 'reach_sure',
                           'parent_up', 'test_near', 'test_hit', 'inherited_test', 'extbind', 'gen_fired',
                           'caller_handles', 'caller_unhandled', 'target_throws')}
    E = _edges(q); rev = _rev(E); sets = _test_sets(q)
    for qq in QS:
        ids = sorted({s for r, _k, s, _x in T if r == qq})
        if not ids: continue
        con = contract_for_method(q, ids)
        out['contract'] += [[c, why, qq] for c, why in con]
        dr = direct_for_method(q, ids)
        out['direct'] += [[c, role, why, cert, (rel(f) if f else ''), str(l), qq] for c, role, why, cert, f, l in dr]
        # seed_of(q,m) for a method target is the target and what the contract binds to it
        seeds = sorted(set(ids) | {c for c, _ in con})
        out['seed'] += [[m, qq] for m in seeds]
        ph = ','.join('?' * len(ids))
        out['direct_edge'] += [[c, m, qq] for c, m in q(
            f"""SELECT DISTINCT caller_id, callee_method_id FROM call_edges
                WHERE callee_method_id IN ({ph}) AND callee_provenance='client'""", *ids)]
        byname = sorted({c for c, _r, _w, cert, _f, _l in dr if cert == 'by name'} - set(seeds))
        out['seed_byname'] += [[c, qq] for c in byname]
        depth = reach_from(rev, seeds, byname)
        out['reach'] += [[m, str(d), qq] for m, d in depth.items()]
        # reach_sure: the same closure from the seeds that are an exact edge only — a seed reached ONLY through a
        # by-name / text / one-of-a-set dependent is weak, and the answer says how much of itself rests on those
        strong = {c for c, _r, _w, cert, _f, _l in dr if cert in ('resolved', 'in scope')}
        weak = {c for c, _r, _w, cert, _f, _l in dr if cert in ('by name', 'text', 'one of a set')} - strong
        out['reach_sure'] += [[m, qq] for m in reach_from(rev, [m for m in seeds if m not in weak])]
        out['parent_up'] += [[a, b, t, qq] for a, b, t in parent_up(E, depth)]
        hits = tests_reaching(q, depth, sets, every=True)
        out['test_hit'] += [[m, str(d), via, qq] for m, d, via in hits]
        out['inherited_test'] += [[s_, m, str(d), qq] for s_, m, d in inherited_tests(q, hits)]
        # extbind: the target's name written in a NON-SOURCE file — an XSD, a template, a config. Nothing in the
        # graph carries these; run() regex-scans the tree for them and hands the hits over.
        #   extbind(q,f,l,n,"names the method")         :- target(q,"method",m,_), named(n,m),      nonsource(n,f,l)
        #   extbind(q,f,l,n,"names the method in full") :- target(q,"method",m,_), qual_name(m,n),  nonsource(n,f,l)
        if nonsource:
            simple = {r[0] for r in q(f"SELECT name FROM symbols WHERE id IN ({ph})", *ids) if r[0]}
            # `qual_name(m, n)` for a METHOD target is the DISPLAY (`SequenceWriter.writeAll`), not the fully
            # qualified name — that is what the exporter appends, and it is what a CREDITS file or an XSD writes.
            full = {r[0] for r in q(f"SELECT display FROM symbols WHERE id IN ({ph})", *ids) if r[0]}
            for n, f, l in nonsource:
                if n in simple: out['extbind'].append([f, str(l), n, 'names the method', qq])
                elif n in full: out['extbind'].append([f, str(l), n, 'names the method in full', qq])
        th = tests_reaching(q, depth, sets)
        out['test_near'] += [[m, str(d), qq] for m, (d, _v) in th.items()]
    out['_targets'] = QS
    return out
