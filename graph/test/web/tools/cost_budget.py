#!/usr/bin/env python3
"""SPEC 11.3 [iter3] storage budgets a fixture can assert, on <out-dir> of `bin/axiomcode <src> <out> --debug`.

  cost_budget.py <out-dir> [--max-bytes-per-ir-row=1536] [--max-index-share=0.40]

  bytes per IR row  = size of web/graph.sqlite / rows of the parser's web IR (.intermediate/ir/web/*.csv, header
                      line excluded)                                                    <= 1.5 KB (1,536 B)
  index share       = pages of every index (dbstat) / pages of the file                 <= 40 %

FAIL when the graph or the IR is missing, when the IR has no row, when dbstat is unavailable (nothing measured), or
when a budget is exceeded. Prints the 5 largest tables and indexes so a miss names its object.
"""
import glob
import os
import sqlite3
import sys


def main():
    out = sys.argv[1]
    opt = {a.split('=', 1)[0][2:]: a.split('=', 1)[1] for a in sys.argv[2:] if a.startswith('--') and '=' in a}
    max_bpr = float(opt.get('max-bytes-per-ir-row', 1536))
    max_idx = float(opt.get('max-index-share', 0.40))
    db_path = os.path.join(out, 'web', 'graph.sqlite')
    if not os.path.isfile(db_path):
        print(f'  no web graph at {db_path}')
        return 1
    csvs = glob.glob(os.path.join(out, '.intermediate', 'ir', 'web', '*.csv'))
    ir_rows = 0
    for c in csvs:
        with open(c, 'rb') as f:
            ir_rows += max(0, sum(1 for _ in f) - 1)
    if ir_rows < 1:
        print(f'  0 IR rows under {out}/.intermediate/ir/web ({len(csvs)} files): nothing to measure')
        return 1
    size = os.path.getsize(db_path)
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    try:
        per = db.execute('select name, sum(pgsize) from dbstat group by name order by 2 desc').fetchall()
    except sqlite3.OperationalError as e:
        print(f'  dbstat unavailable ({e}): index share not measured')
        return 1
    indexes = {r[0] for r in db.execute("select name from sqlite_master where type = 'index'")}
    total = sum(p for _n, p in per)
    idx = sum(p for n, p in per if n in indexes or n.startswith('sqlite_autoindex_'))
    if total < 1:
        print('  dbstat reports 0 pages: nothing measured')
        return 1
    bpr = size / ir_rows
    share = idx / total
    print(f'  graph.sqlite {size:,} B; IR rows {ir_rows:,} ({len(csvs)} files); {bpr:,.0f} B per IR row <= {max_bpr:,.0f}; '
          f'indexes {idx:,} of {total:,} B = {share:.1%} <= {max_idx:.0%}')
    print('  largest: ' + ', '.join(f'{n} {p / 1e6:.1f} MB' for n, p in per[:5]))
    return 0 if bpr <= max_bpr and share <= max_idx else 1


if __name__ == '__main__':
    sys.exit(main())
