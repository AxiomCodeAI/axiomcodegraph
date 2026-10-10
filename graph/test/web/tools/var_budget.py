#!/usr/bin/env python3
"""SPEC 3.4a row caps on the stored var tables of <out-dir>/web/graph.sqlite.

  var_budget.py <out-dir>

  web_var_visible <= 4 x (#VARIABLE value_refs + #custom-property declarations)
  web_var_scope   <= 2 x #web_styles rows whose rule has a declaration using var()   and   <= 2,000,000
FAIL when a table is missing, when either cap is broken, or when there is nothing to measure
(0 var() uses: the check would be vacuous).
"""
import os
import sqlite3
import sys


def main():
    path = os.path.join(sys.argv[1], 'web', 'graph.sqlite')
    if not os.path.isfile(path):
        print(f'  no web graph at {path}')
        return 1
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    have = {r[0] for r in db.execute("select name from sqlite_master where type in ('table','view')")}
    for t in ('web_var_def', 'web_var_visible', 'web_var_scope', 'web_var', 'web_value_refs', 'web_declarations', 'web_styles', 'web_selectors'):
        if t not in have:
            print(f'  {t} missing (SPEC 3.4a)')
            return 1
    one = lambda sql: db.execute(sql).fetchone()[0]
    uses = one("select count(*) from web_value_refs where reference_kind = 'VARIABLE'")
    decls = one("select count(*) from web_declarations where property like '--%'")
    visible = one('select count(*) from web_var_visible')
    scope = one('select count(*) from web_var_scope')
    styles_var = one("""select count(*) from web_styles st join web_selectors se on se.uid = st.selector_uid
                        where se.rule_uid in (select rule_uid from web_declarations where value_text like '%var(%')""")
    view = db.execute("select type from sqlite_master where name = 'web_var'").fetchone()[0]
    ok = True
    print(f'  var() uses {uses}, custom-property declarations {decls}, styles rows of var-using rules {styles_var}')
    if uses < 1:
        print('  FAIL: no var() use to measure (vacuous)'); ok = False
    cap_v = 4 * (uses + decls)
    print(f'  web_var_visible {visible} <= {cap_v}: {"ok" if visible <= cap_v else "OVER"}')
    cap_s = min(2 * styles_var, 2_000_000)
    print(f'  web_var_scope {scope} <= {cap_s}: {"ok" if scope <= cap_s else "OVER"}')
    if view != 'view':
        print(f'  FAIL: web_var is a {view}, SPEC 3.4a says a view (not materialized)'); ok = False
    return 0 if ok and visible <= cap_v and scope <= cap_s else 1


if __name__ == '__main__':
    sys.exit(main())
