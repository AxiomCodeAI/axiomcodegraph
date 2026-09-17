"""fastimpact.py — the few lines an edit hook prints, answered straight from graph.sqlite.

`hooks/changes.py` prints, per changed declaration: what must change with it, what reads or uses it, and how many
callables and tests the change reaches. Getting those from `axiomcode impact` costs a full Datalog run: on a
1.2M-LOC Java repository (8,390 files, 804k call edges) that was a median 6.94 s, p90 23.8 s, max 30.5 s, and
**17 of 38 randomly sampled methods exceeded changes.py's own timeout=14** — so on roughly half of real edits the
hook printed "(impact unavailable)" after burning the full timeout. It also produced up to 18 MB of JSON to print
four lines. The same four lines from SQL are a flat 1.5-2.0 s (median 1.54, max 1.96, none over 14), because the
work is indexed lookups plus one depth-capped closure rather than a whole-graph solve.

This is NOT a replacement for `axiomcode impact`. It answers the hook's question only. The tiers it does not
reproduce -- `alongside` (siblings of the same type) and `one of a set` (a narrowed dispatch set) -- are judgement
`impact.dl` derives, and the CLI/MCP keep it. `certain()` says what is covered, so a caller can fall back.

Ground truth checked by hand: for a method that overrides and super-calls its parent, `contract` and `reads` both
name it, matching the source and matching impact.dl. Two defects the checking found, both fixed here:
  * `symbols.display` is NOT unique -- 5,127 of 85,154 methods share one (overloads). Resolving with LIMIT 1
    silently answers about an arbitrary overload; joining on display cross-products the result. Everything below
    resolves to ids and treats every overload of the named method as the change set.
  * the by-name tier must join `unresolved_sites`. `call_sites.callee_name` alone returns the resolved sites too
    (5,336 vs 732 for one target). With the join it matches impact.dl exactly: 732 = 732.
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
