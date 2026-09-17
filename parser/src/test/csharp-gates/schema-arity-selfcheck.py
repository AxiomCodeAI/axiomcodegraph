#!/usr/bin/env python3
"""
Gate: every relation heading in CSHARP-FACT-SCHEMA.md must agree with its own column LIST,
and every relation must HAVE a list.

This exists because eight headings disagreed with their lists and eight relations had a count
and no list at all, which blocked cs-impl for two rounds. The list is the contract — column
ORDER is the contract, and only a list states an order — so the heading yields to the list.

Run: python3 src/test/csharp-gates/schema-arity-selfcheck.py
Exit 0 clean, 1 on any mismatch or missing list.
"""
import re, sys, os

DOC = os.path.join(os.path.dirname(__file__), '..', '..', 'schema', 'csharp', 'CSHARP-FACT-SCHEMA.md')
TRAILER = ['isExternal', 'serviceVersionLinkHash']

def check_version_header(s):
    """
    The title's version must equal the highest RULING (vX) in the body.

    This exists because the title said v1.1 while the body carried v1.9 rulings, so there was no
    single place stating the current version — and two agents inferred it from commit messages
    instead, which name one ruling and never the document. They diverged on whether
    FIELD/PROPERTY/EVENT was v1.7 or v1.8 and pre-registered row-count movements against their own
    numbering, which is how a sweep reads a ruling as a regression.
    """
    m = re.search(r'^# C# fact-table schema — v([0-9]+(?:\.[0-9]+)*)', s, re.M)
    if not m:
        return ['title does not state a version']
    title = m.group(1)
    body = re.findall(r'RULING \(v([0-9]+(?:\.[0-9]+)*)\)', s)
    if not body:
        return ['no RULING (vX) markers found — the check cannot see its subject']
    key = lambda v: tuple(int(x) for x in v.split('.'))
    highest = max(body, key=key)
    if key(title) < key(highest):
        return [f'title says v{title} but the body contains a RULING (v{highest}) — '
                f'advance the title, or the version means two things']
    return []


def main():
    s = open(DOC).read()
    header = check_version_header(s)
    for h in header:
        print(f'  FAIL version header: {h}')
    blocks = re.findall(r'### (3\.\d+) `(cs_\w+)` — (\d+) columns[^\n]*\n(.*?)(?=\n### |\n## )', s, re.S)
    if not blocks:
        print('FAIL: no relations parsed — the gate cannot see its subject'); return 1
    bad = []
    for _num, rel, cnt, body in blocks:
        m = re.search(r'```\n(.*?)\n```', body, re.S)
        if not m:
            bad.append((rel, cnt, None, 'NO COLUMN LIST')); continue
        cols = [c.strip() for c in m.group(1).replace('\n', ' ').split(',') if c.strip()]
        if int(cnt) != len(cols):
            bad.append((rel, cnt, len(cols), 'heading disagrees with list'))
        # trailer convention: last three are isExternal, serviceVersionLinkHash, <entity>UniqueHash
        if cols[-3:-1] != TRAILER:
            bad.append((rel, cnt, len(cols), f'trailer is {cols[-3:]} — expected [..{TRAILER}, <entity>UniqueHash]'))
        if not cols[-1].endswith('UniqueHash'):
            bad.append((rel, cnt, len(cols), f'last column is {cols[-1]!r}, not the unique hash'))
        if len(set(cols)) != len(cols):
            dupes = sorted({c for c in cols if cols.count(c) > 1})
            bad.append((rel, cnt, len(cols), f'DUPLICATE COLUMNS {dupes} — duplicates double, they do not collide'))
    print(f'{len(blocks)} relations checked')
    for rel, h, l, why in bad:
        print(f'  FAIL {rel}: heading={h} list={l} — {why}')
    if bad or header:
        return 1
    print('all relations: heading == list, trailer convention held, no duplicate columns')
    return 0

if __name__ == '__main__':
    sys.exit(main())
