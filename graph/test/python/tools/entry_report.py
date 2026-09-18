#!/usr/bin/env python3
"""The per-case ENTRY POINT golden — the relation .edges and .tiers cannot see.

WHY IT NEEDS ITS OWN GOLDEN. An entry point is a declaration NOTHING CALLS: a route
handler the framework invokes on a request. It therefore contributes no edge, and
`.edges` and `.tiers` are both blind to it by construction. Losing the relation, or
gaining a wrong member, would not move either file.

WHAT A WRONG MEMBER COSTS. The claim is "a framework invokes this, so no client call
site reaches it". Asserted of something ordinary it is a fabrication with no call edge
to contradict it — and the first version of the rule made exactly that mistake:
`patch` is an HTTP method AND the stdlib's mock entry point, so `@mock.patch(...)`
was marked a live HTTP route, 229 times across five real projects. Case
16-route-entry-points carries that shape on purpose; if it ever appears here, the
second condition has been lost.

Hashes are resolved to qualified names and paths to basenames, so the golden is
reviewable and survives a rebuild on another machine.

usage: entry_report.py <IR-dir> <OUT-dir>
"""
import csv
import os
import sys

csv.field_size_limit(10**9)


def rows(path, delim='\t'):
    if not os.path.exists(path):
        return []
    with open(path, newline='') as fh:
        r = list(csv.reader(fh, delimiter=delim))
    if not r:
        return []
    return [dict(zip(r[0], x + [''] * (len(r[0]) - len(x)))) for x in r[1:]]


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: entry_report.py <IR-dir> <OUT-dir>")
    ir, out = sys.argv[1], sys.argv[2]

    name = {}
    for m in rows(os.path.join(ir, 'all-python-methods.csv')):
        h = m.get('pyMethodUniqueHash')
        if not h:
            continue
        q = m.get('qualifiedName') or m.get('name') or h
        f = os.path.basename((m.get('filePath') or '').replace(os.sep, '/'))
        name[h] = f"{q}   {f}:{m.get('startLine') or '0'}"

    # entry-point.csv is (method, reason) and has no header: it is a Souffle output.
    p = os.path.join(out, 'entry-point.csv')
    seen = set()
    if os.path.exists(p):
        with open(p, newline='') as fh:
            for r in csv.reader(fh, delimiter='\t'):
                if len(r) >= 2:
                    seen.add((r[1], name.get(r[0], r[0])))

    print(f"── entry_point ({len(seen)}) ──")
    for reason, who in sorted(seen):
        print(f"  {reason:10s} {who}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
