#!/usr/bin/env python3
"""The per-case FRAMEWORK EDGE golden — the relation .edges, .tiers and .entries all miss.

WHY IT NEEDS ITS OWN GOLDEN, and this file exists because the gap was real. When the
five framework cases were first blessed, every one of them passed with `.edges`,
`.tiers` and `.entries` pinned, and NOT ONE of those files mentioned a framework edge.
The suite would have stayed green with the whole of framework-behavior/ deleted.

The three existing goldens are blind to it by construction:

  .edges    holds call_chain_edge. A framework hop is deliberately NOT one: it may
            cross a process and it carries a different confidence, so it is emitted as
            its own relation (framework-behavior/dispatch.dl). Nothing joins them.
  .tiers    counts CALL SITES by tier. A framework hop has no site of its own; the
            producer's site (`x.delay(k)`) stays ambiguous_unknown either way, so the
            census is byte-identical whether the rule fires or not.
  .entries  pins the CONSUMER half only ("a framework invokes this"). It says nothing
            about WHICH producer reaches it, which is the entire content of the edge.

So the census here is the only thing standing between a working rule and a rule that
silently produces nothing. That failure mode is not hypothetical: three separate join
bugs in the first draft of these rules (a provenance column read as a parent, a site
hash passed where an expression hash was wanted, and a per-occurrence binding hash
joined across two ends) each made a rule emit ZERO rows while compiling cleanly and
leaving every other golden untouched.

WHAT A WRONG MEMBER COSTS. A framework edge asserts that a change to one declaration
reaches another with no call site between them. Asserted wrongly it is a fabrication
that no call edge contradicts, because by construction there is no call edge there.
Every case therefore carries a NEGATIVE half -- an ordinary method named `delay`, a
`path(...)` outside a route table, an eagerly called provider -- and the count on the
`framework_unjoined` line is what proves the engine saw those and declined them, rather
than never having looked.

Hashes are resolved to qualified name plus repo-relative path, so the golden is
reviewable, disambiguates two files of the same name, and survives a rebuild elsewhere.

usage: framework_report.py <IR-dir> <OUT-dir>
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
        raise SystemExit("usage: framework_report.py <IR-dir> <OUT-dir>")
    ir, out = sys.argv[1], sys.argv[2]

    # "framework_edge (0)" IS THE TRUTH for 20 of the 22 pre-existing cases, so it must
    # not also be what a missing output directory prints. It already cost one wrong
    # conclusion: a suite run without --keep deletes the per-case work dir, this tool was
    # pointed at the deleted path, and the resulting (0) read exactly like a rule that
    # had regressed to emitting nothing. The path is named so the next reader sees which
    # of the two it is.
    if not os.path.isdir(out):
        raise SystemExit(f"framework_report: no output directory at {out} "
                         f"-- nothing was read, which is not the same as no rows")

    # The endpoint is rendered as qualifiedName@path, and the PATH IS NOT DECORATION.
    # Two `conftest.py` files in different directories give their fixtures the SAME
    # qualified name, and fixture shadowing -- a nearer conftest overriding a farther
    # one -- is precisely a case where the rule must pick one of two identically named
    # declarations. Without the path the golden renders both choices identically, so
    # picking the WRONG one would not move this file, which is the one thing the case
    # exists to catch. Paths are repo-relative, so the golden survives a rebuild
    # elsewhere.
    name = {}
    for m in rows(os.path.join(ir, 'all-python-methods.csv')):
        h = m.get('pyMethodUniqueHash')
        if not h:
            continue
        q = m.get('qualifiedName') or m.get('name') or h
        f = (m.get('filePath') or '').replace(os.sep, '/')
        name[h] = f"{q}@{f}" if f else q

    # framework-edge.csv is (from, to, mechanism, detail, confidence), no header:
    # it is a Souffle output.
    edges = set()
    p = os.path.join(out, 'framework-edge.csv')
    if os.path.exists(p):
        with open(p, newline='') as fh:
            for r in csv.reader(fh, delimiter='\t'):
                if len(r) >= 5:
                    edges.add((r[2], r[4], name.get(r[0], r[0]), name.get(r[1], r[1]), r[3]))

    print(f"── framework_edge ({len(edges)}) ──")
    for mech, conf, src, dst, detail in sorted(edges):
        print(f"  {mech:18s} {conf:11s} {src} -> {dst}   [{detail}]")

    # The diagnostic half. A count alone is enough: it is the difference between "the
    # engine looked at this dispatch-shaped site and declined it" and "no rule ran".
    # Pinning the site hash would make the golden churn on any unrelated reparse.
    unjoined = {}
    p = os.path.join(out, 'framework-unjoined.csv')
    if os.path.exists(p):
        with open(p, newline='') as fh:
            for r in csv.reader(fh, delimiter='\t'):
                if len(r) >= 3:
                    unjoined[(r[1], r[2])] = unjoined.get((r[1], r[2]), 0) + 1

    total = sum(unjoined.values())
    print(f"── framework_unjoined ({total}) ──")
    for (mech, detail), n in sorted(unjoined.items()):
        print(f"  {n:4d}  {mech:18s} {detail}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
