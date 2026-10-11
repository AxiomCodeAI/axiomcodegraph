#!/usr/bin/env python3
"""Per-language guard (HTML/CSS-only web layer): the web graph holds no JavaScript, and building it leaves the
javascript graph of the same tree unchanged.

  crosslang_guard.py <out-web+js> <out-js-only>

<out-web+js> = bin/axiomcode <src> <dir> --language web,javascript; <out-js-only> = the same with --language
javascript. FAIL when
  - any TEXT value of <out-web+js>/web/graph.sqlite is a JavaScript/TypeScript node id (JS_*/TS_*_<md5>),
    or the web graph has a table named like the JS graph's own (methods, call_edges ...) with rows,
  - <out-web+js>/javascript/graph.sqlite differs from <out-js-only>/javascript/graph.sqlite in any table row
    (values are compared with each run's own directory replaced by <OUT>, and timing/build-stamp columns dropped),
  - either scan compares nothing (0 values / 0 rows is not a pass).
"""
import os
import re
import sqlite3
import sys

JS_ID = re.compile(r'^(JS|TS)_[A-Z_]+_[0-9a-f]{32}$')
VOLATILE_COL = re.compile(r'(time|_at$|duration|elapsed|seconds|_ms$|built|created|stamp|version)', re.I)
CALL_TABLES = ('methods', 'call_edges', 'call_sites', 'overrides', 'dispatch_candidates')


def connect(p):
    if not os.path.isfile(p):
        print(f'  no graph at {p}')
        sys.exit(1)
    return sqlite3.connect(f'file:{p}?mode=ro', uri=True)


def tables(db):
    return sorted(r[0] for r in db.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'"))


def dump(db, root):
    out = {}
    for t in tables(db):
        cols = [r[1] for r in db.execute(f'pragma table_info("{t}")') if not VOLATILE_COL.search(r[1])]
        if not cols:
            continue
        rows = []
        for r in db.execute(f'select {", ".join(chr(34) + c + chr(34) for c in cols)} from "{t}"'):
            # a key/value table (run) holds build stamps as ROWS: drop the volatile keys, not just columns
            if len(r) == 2 and isinstance(r[0], str) and VOLATILE_COL.search(r[0]):
                continue
            rows.append(tuple(v.replace(root, '<OUT>') if isinstance(v, str) else v for v in r))
        out[t] = sorted(rows, key=repr)
    return out


def main():
    both, jsonly = sys.argv[1], sys.argv[2]
    ok = True
    web = connect(os.path.join(both, 'web', 'graph.sqlite'))
    hits, scanned = [], 0
    for t in tables(web):
        cols = [r[1] for r in web.execute(f'pragma table_info("{t}")')]
        for c in cols:
            for (v,) in web.execute(f'select "{c}" from "{t}" where "{c}" is not null'):
                scanned += 1
                if isinstance(v, str) and JS_ID.match(v):
                    hits.append(f'{t}.{c} = {v}')
    print(f'  web graph values holding a JavaScript id: {len(hits)} of {scanned} scanned')
    if scanned < 1 or hits:
        ok = False
        for h in hits[:10]:
            print(f'    {h}')
    for t in CALL_TABLES:
        if t in tables(web):
            n = web.execute(f'select count(*) from "{t}"').fetchone()[0]
            if n:
                print(f'  web graph table {t} has {n} rows (a call graph is not HTML/CSS)')
                ok = False
    a = dump(connect(os.path.join(both, 'javascript', 'graph.sqlite')), os.path.abspath(both))
    b = dump(connect(os.path.join(jsonly, 'javascript', 'graph.sqlite')), os.path.abspath(jsonly))
    rows = sum(len(v) for v in b.values())
    print(f'  javascript graph: {len(b)} tables, {rows} rows compared')
    if rows < 1:
        print('  FAIL: the javascript-only graph is empty (nothing compared)')
        ok = False
    for t in sorted(set(a) | set(b)):
        if a.get(t) != b.get(t):
            ok = False
            ra, rb = set(a.get(t, [])), set(b.get(t, []))
            print(f'  javascript graph differs in {t}: +{len(ra - rb)} -{len(rb - ra)} rows with the web layer built')
            for r in list(ra - rb)[:3]:
                print(f'    + {r}')
            for r in list(rb - ra)[:3]:
                print(f'    - {r}')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
