#!/usr/bin/env python3
"""Self-test of normalize.py's failure mode (V3-07, V3-11): a graph the contract does not fit (a missing table, a
NULL key) must give a `normalize_error` row next to the rows read so far and exit 3, never a traceback with an
empty file. Builds two tiny graphs in a temp dir; exit 1 on any surprise."""
import os
import sqlite3
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def run(build):
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, 'web'))
    db = sqlite3.connect(os.path.join(d, 'web', 'graph.sqlite'))
    build(db); db.commit(); db.close()
    p = subprocess.run([sys.executable, os.path.join(HERE, 'normalize.py'), d], capture_output=True, text=True)
    return p.returncode, p.stdout.splitlines()


def main():
    bad = []
    # 1. only web_pages: the page rows survive, then a normalize_error for the first missing table
    rc, out = run(lambda db: (db.execute('create table web_pages(uid, file, document_kind)'),
                              db.execute("insert into web_pages values ('P1', 'a.html', 'DOCUMENT')")))
    if rc != 3 or 'page\ta.html\tDOCUMENT' not in out or not any(l.startswith('normalize_error\t') for l in out):
        bad.append(f'missing table: rc={rc}, rows={out[:3]}')
    # 2. a NULL element key inside a query that sorts keys: still rows out, never an empty file
    rc, out = run(lambda db: (db.execute('create table web_pages(uid, file, document_kind)'),
                              db.execute("insert into web_pages values ('P1', 'a.html', 'DOCUMENT')"),
                              db.execute('create table web_elements(uid, page_uid, parent_uid, file, line, col, tag_name, html_id, class_names, inert)'),
                              db.execute("insert into web_elements values (NULL, 'P1', NULL, NULL, NULL, NULL, 'div', NULL, NULL, NULL)")))
    if not out:
        bad.append(f'NULL element: empty output (rc={rc})')
    for b in bad:
        print(f'  {b}')
    print(f'normalize self-test: {2 - len(bad)}/2 checks')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
