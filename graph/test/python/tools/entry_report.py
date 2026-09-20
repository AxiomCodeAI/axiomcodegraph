#!/usr/bin/env python3
"""The per-case FRAMEWORK-BEHAVIOUR golden — the relations .edges and .tiers cannot see.

Two of them now: `entry_point`, and the cross-process `remote_edge` / `remote_unserved` /
`remote_unsent`. The argument below is the same for both — a cross-process hop is not a
call edge either, so .edges is blind to it, and a wrong member is a claim no edge can
contradict.

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
        # THE PATH, NOT THE BASENAME. Two directories may hold a file of the same name,
        # and then two different declarations print identically and a reviewer cannot
        # tell which one a row is about. `conftest.py` is the common case (pytest puts
        # one per directory, and every one of them is the module `conftest`), and this
        # corpus already has a second: 15-build-artifact-exclusion carries two `core.py`
        # and two `__init__.py`. For a case whose files all sit at the root of src/ the
        # path IS the basename, so those goldens are unchanged.
        f = (m.get('filePath') or '').replace(os.sep, '/')
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

    # The cross-process relations. remote_edge is (from, to, transport, destination,
    # confidence); the two unjoined halves are (method, transport, destination). Each is
    # printed with its destination, because the destination IS the claim: an edge joined on
    # the wrong string is the failure mode, and a reviewer cannot see it from the endpoints.
    for rel, cols in (('remote-edge', 5), ('remote-unserved', 3), ('remote-unsent', 3)):
        rp = os.path.join(out, rel + '.csv')
        if not os.path.exists(rp):
            continue
        got = set()
        with open(rp, newline='') as fh:
            for r in csv.reader(fh, delimiter='\t'):
                if len(r) < cols:
                    continue
                if cols == 5:
                    got.add((r[3], name.get(r[0], r[0]), name.get(r[1], r[1]), r[4]))
                else:
                    got.add((r[2], name.get(r[0], r[0]), '', ''))
        print(f"\n── {rel.replace('-', '_')} ({len(got)}) ──")
        for dest, a, b, conf in sorted(got):
            print(f"  {dest}" + (f"\n      {a}\n   -> {b}   [{conf}]" if b else f"\n      {a}"))
    return 0


if __name__ == '__main__':
    sys.exit(main())
