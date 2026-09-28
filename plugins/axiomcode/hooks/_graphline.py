"""What the enrich and changes hooks print about one declaration, where a bare number would mislead.

  zero_label   a method with no resolved caller. Of 323 caller counts the Read / Grep hooks printed in headless
               sessions, 209 were `← 0`, and most of those were methods a framework calls: a route handler, an
               `@app.before_request`, a scheduled job, a library override. The graph stores why for most of them,
               so the line says it: `entry (http)`, `0 resolved, 3 by name`, `? framework (@Scheduled)`. A method
               with no signal at all still reads `0`. The reason is graph_sql.no_caller_reasons, which impact and
               path read too.
  callers_via_base  the callers through an interface or base method, which impact lists and call_edges lacks.
  body_line    an edit that changed only bodies breaks no caller; the one thing worth saying is which tests reach
               it and how to run them. The block it replaces listed 10-42 readers, and 28 of 30 went unused.

Every lookup is one indexed query per declaration (these run on every Read, Grep and Edit)."""
import importlib.machinery, importlib.util, os, sqlite3

import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts'))
import graph_sql


def _q(con):
    return lambda sql, *p: con.execute(sql, p).fetchall()


def zero_label(con, mid, name=None, is_test=0):
    """what `← 0` means for method `mid`: the FIRST reason graph_sql.no_caller_reasons gives, the one reader impact's
    `next:` and path's empty-upstream note word too, so the three never give different reasons for one method:
        entry (<reason>)            the runtime invokes it: a route, a test, main, a scheduled job, a listener
        ? framework (@X)            a decoration a framework reads (a wrapper such as a cache or a permission check is not one)
        ? framework (overrides B)   it overrides a method the graph does not contain
        ? framework (extends B)     its type derives from a base outside the graph
        ? framework (@X on Owner)   a decoration on its type
        0 resolved, N by name       N call sites write its name on a receiver the engine could not type
        0                           none of these: nothing in this graph calls it
    `name` and `is_test` are read from the graph; the parameters stay for callers that pass them."""
    try:
        rs = graph_sql.no_caller_reasons(_q(con), [mid]).get(mid) or []
        if not rs and is_test: return "entry (test)"
        if rs: return graph_sql.no_caller_label(rs[0][0], rs[0][1])
    except sqlite3.Error:
        pass
    return "0"


def callers_via_base(con, mids, repo='.'):
    """{method id: {caller id}}: the callers through an interface or base method that impact lists and call_edges does
    not hold (graph_sql.callers_via_base), read with the repository's lines so a narrowed interface-typed field counts"""
    cache = {}
    def lines(f):
        if f not in cache:
            try: cache[f] = open(os.path.join(repo, f), encoding='utf-8', errors='replace').read().splitlines()
            except OSError: cache[f] = []
        return cache[f]
    try: return graph_sql.callers_via_base(_q(con), list(mids), lines)
    except sqlite3.Error: return {}


def distinct_paths(files):
    """the shortest path suffix that tells these files apart: two `StubConverterFactory.java` in different modules print
    as `json/StubConverterFactory.java` and `xml/StubConverterFactory.java`, never as the same line twice"""
    parts = [f.split('/') for f in files]
    out = []
    for i, p in enumerate(parts):
        k = 1
        while k < len(p) and any(j != i and q[-k:] == p[-k:] for j, q in enumerate(parts)): k += 1
        out.append('/'.join(p[-k:]))
    return out


_TI = None
def _ti():
    """axiomcode-test-impact as a module, loaded once; None when it cannot be"""
    global _TI
    if _TI is None:
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts', 'axiomcode-test-impact')
        try:
            ld = importlib.machinery.SourceFileLoader('ax_test_impact', p)
            m = importlib.util.module_from_spec(importlib.util.spec_from_loader('ax_test_impact', ld)); ld.exec_module(m)
            _TI = m
        except Exception:
            _TI = False
    return _TI or None


def _command_for(lang, files, classes, db=None, repo='.'):
    """the runnable command `axiomcode test-impact` prints, from the same function; a TypeScript/JavaScript selection
    can need one command per package and runner, joined with '; ' here because the hook's answer is one line"""
    try: cmd = _ti().command_for(lang, files, classes, db, repo)
    except Exception: return None
    return cmd.replace("\n", "; ") if cmd else cmd


def _concrete(db, classes):
    """the classes a runner can run: each abstract test class replaced by the classes that extend it (test-impact)"""
    try: return _ti().concrete_test_classes(db, classes)[0]
    except Exception: return classes


import _where
LANG = {e: ls[0] for e, ls in _where.BY_EXT.items()}          # one table for every hook (_where.py)
SHOWN = 6


def body_line(db, results, repo='.'):
    """ONE line for an edit that changed only bodies: which declarations, how many tests reach them, how to run those.
    `results` is [(changed-declaration, impact-json)], the same pairs the blast-radius block is built from."""
    names = [d['symbol'] for d, _ in results]
    ids, owners, files = set(), set(), set()
    for d, j in results:
        ids |= set((j or {}).get('test_ids') or [])
        for t in (j or {}).get('tests') or []:                 # the rules' answer carries names, not ids
            if not (j or {}).get('_sql') and t.get('owner'): owners.add(t['owner'])
            if not (j or {}).get('_sql') and t.get('at'): files.add(t['at'].split(':')[0])
    n = len(ids) or sum(len((j or {}).get('tests') or []) for _, j in results)
    if ids:
        try:
            con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
            idl = sorted(ids)
            for i in range(0, len(idl), 400):
                ch = idl[i:i + 400]
                for o, f in con.execute(f"SELECT owner, file FROM symbols WHERE id IN ({','.join('?' * len(ch))})", ch):
                    if o: owners.add(o)
                    if f: files.add(f)
            con.close()
        except sqlite3.Error:
            pass
    what = ', '.join(names[:3]) + (f" +{len(names) - 3}" if len(names) > 3 else '')
    if not n:
        return f"graph: body edit of {what}: no test reaches it through the graph (a lower bound)"
    lang = LANG.get(os.path.splitext(results[0][0].get('file', ''))[1], '')
    fl, cl = sorted(files), sorted(owners)
    if lang in ('java', 'csharp') and cl:
        cl = sorted(_concrete(db, cl))      # before the cut, so the command and the "+N more" count the same classes
    cmd = _command_for(lang, fl[:SHOWN], cl[:SHOWN], None, repo)
    more = (len({c.split('.')[-1] for c in cl}) if lang in ('java', 'csharp') and cl else len(fl)) - SHOWN
    tail = (f"; run: {cmd}" + (f" (+{more} more: axiomcode test-impact)" if more > 0 else '')) if cmd else "; axiomcode test-impact gives the command"
    return f"graph: body edit of {what}: {n} test(s) reach it{tail}"
