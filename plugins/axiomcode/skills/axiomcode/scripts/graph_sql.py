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
