#!/usr/bin/env python3
"""SPEC 3.5 [iter2] unknown-row grain on <out-dir>/web/graph.sqlite.

  unknown_budget.py <out-dir>

FAIL when web_unknown holds more than 0.1 x web_styles rows + 10,000, when any web_unknown row has reason
no_static_carrier (that reason lives on the selector row), or when web_styles is empty (nothing to measure).
"""
import os
import sqlite3
import sys


def main():
    p = os.path.join(sys.argv[1], 'web', 'graph.sqlite')
    if not os.path.isfile(p):
        print(f'  no web graph at {p}')
        return 1
    db = sqlite3.connect(f'file:{p}?mode=ro', uri=True)
    one = lambda q: db.execute(q).fetchone()[0]
    styles = one('select count(*) from web_styles')
    unknown = one('select count(*) from web_unknown')
    nsc = one("select count(*) from web_unknown where reason = 'no_static_carrier'")
    sel_nsc = one("select count(*) from web_selectors where unknown_reason = 'no_static_carrier'")
    cap = int(0.1 * styles) + 10000
    print(f'  web_styles {styles}; web_unknown {unknown} <= {cap}; no_static_carrier in web_unknown {nsc} (must be 0); on selectors {sel_nsc}')
    ok = styles >= 1 and unknown <= cap and nsc == 0
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
