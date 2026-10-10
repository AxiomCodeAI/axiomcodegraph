#!/usr/bin/env python3
"""Per-language guard (SPEC scope 3): ZERO edges join the web graph and the JavaScript graph, while
BOTH sides carry their join keys as attributes.

  crosslang_guard.py <out-dir>

FAIL when
  - any TEXT value in any table of <out-dir>/web/graph.sqlite is a JavaScript node id (JS_*_<md5>),
  - any TEXT value in any table of <out-dir>/javascript/graph.sqlite is a web node id (HTML_*/CSS_*_<md5>),
  - the web graph has no handler call with a callee_name, or no script with a js_module_path,
  - the JavaScript graph has no ext_dom_touch row with a literal.
Each check prints how many values it scanned; scanning nothing is a FAIL.
"""
import os
import re
import sqlite3
import sys

JS_ID = re.compile(r'^(JS|TS)_[A-Z_]+_[0-9a-f]{32}$')
WEB_ID = re.compile(r'^(HTML|CSS)_[A-Z_]+_[0-9a-f]{32}$')


def scan(db, pattern):
    hits, scanned = [], 0
    for (t,) in db.execute("select name from sqlite_master where type='table'"):
        cols = [r[1] for r in db.execute(f'pragma table_info("{t}")') if (r[2] or '').upper() in ('TEXT', '')]
        for c in cols:
            for (v,) in db.execute(f'select "{c}" from "{t}" where "{c}" is not null'):
                scanned += 1
                if isinstance(v, str) and pattern.match(v):
                    hits.append(f'{t}.{c} = {v}')
    return hits, scanned


def count(db, sql):
    try:
        return db.execute(sql).fetchone()[0]
    except sqlite3.Error as e:
        print(f'  query failed: {sql}: {e}')
        return 0


def main():
    out = sys.argv[1]
    ok = True
    paths = {lang: os.path.join(out, lang, 'graph.sqlite') for lang in ('web', 'javascript')}
    for lang, p in paths.items():
        if not os.path.isfile(p):
            print(f'  no {lang} graph at {p}')
            return 1
    web = sqlite3.connect(f'file:{paths["web"]}?mode=ro', uri=True)
    js = sqlite3.connect(f'file:{paths["javascript"]}?mode=ro', uri=True)
    for name, db, pat in (('web graph holds a JavaScript id', web, JS_ID), ('JavaScript graph holds a web id', js, WEB_ID)):
        hits, scanned = scan(db, pat)
        print(f'  {name}: {len(hits)} of {scanned} values scanned')
        if scanned < 1 or hits:
            ok = False
            for h in hits[:10]:
                print(f'    {h}')
    keys = (
        ('web handler calls with a callee_name', web, "select count(*) from web_handler_calls where coalesce(callee_name,'') <> ''"),
        ('web scripts with a js_module_path', web, "select count(*) from web_scripts where coalesce(js_module_path,'') <> ''"),
        ('JS dom touches with a literal', js, "select count(*) from ext_dom_touch where status = 'literal' and coalesce(literal,'') <> ''"),
    )
    for name, db, sql in keys:
        n = count(db, sql)
        print(f'  join key present — {name}: {n}')
        if n < 1:
            ok = False
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
