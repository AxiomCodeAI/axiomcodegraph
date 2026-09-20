#!/usr/bin/env python3
"""The per-case ENTRY POINT golden — the relation .edges and .type-use cannot see.

A PORT of graph/test/python/tools/entry_report.py, for the same reason and with the
same output shape, reading the TypeScript IR's column names.

WHY IT NEEDS ITS OWN GOLDEN. An entry point is a declaration NOTHING CALLS: a route
handler a router invokes on a request, a constructor a DI container calls, a lifecycle
hook the framework looks up by name. It contributes no edge by construction, so
`.edges` is blind to it. Case 68 demonstrated the cost directly — it was green, and
green while asserting nothing about the roots it exists to test.

WHAT A WRONG MEMBER COSTS. The claim is "a framework invokes this, so no call site in
the repository reaches it". Asserted of something ordinary it is a fabrication with no
call edge to contradict it. Python's version records the shape that caught it there:
`patch` is an HTTP verb AND the stdlib's mock entry point, and `@mock.patch(...)` was
marked a live route 229 times. TypeScript's equivalent is a project that writes its own
`@Get`, or a plain class with a method called `ngOnInit` — which is why case 68 carries
both as negative controls, and why every decorator root rule is guarded by the CLASS
decorator rather than by the member name alone.

Hashes resolve to qualified names and paths to basenames, so the golden is reviewable
and survives a rebuild on another machine.

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
    for m in rows(os.path.join(ir, 'all-typescript-methods.csv')):
        h = m.get('tsMethodUniqueHash')
        if not h:
            continue
        # qualifiedName already carries the owner (`container#OrderController.getOne`),
        # so prefixing ownerTypeName again produced `OrderController#container#...`.
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
