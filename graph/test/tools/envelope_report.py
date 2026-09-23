#!/usr/bin/env python3
"""The dispatch envelope of one case, in a form a human can check against the source.

WHY THIS EXISTS. `dispatch_candidates` is the set `call_edges` was narrowed FROM, and it is
the only table in the bundle that answers "what ELSE might run here". It was Java-only for
the whole life of the output bundle: the relation was computed in every language and
projected in one, so a consumer got a full answer from a Java bundle and silence from the
other two, with no error (#471). A relation that can be empty without anything failing is a
relation that can be silently reverted, so it needs a test that reads it.

The report is hash-free on purpose. Every id in the raw relation derives from baseMservPath,
so a golden written in hashes would only ever pass on the machine that blessed it; the
qualified names come from the IR and are stable across checkouts.

usage: envelope_report.py <ir-dir> <raw-dir> <methods-csv> <hash-column> [--library <ir-dir>]
"""
import csv
import os
import sys

csv.field_size_limit(10 ** 9)


def rows(path, rfc=True):
    """Raw relations are TSV written by souffle; IR entity tables are RFC4180 CSV-in-TSV."""
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8', errors='replace') as fh:
        return list(csv.reader(fh, delimiter='\t')) if rfc else \
               list(csv.reader(fh, delimiter='\t', quoting=csv.QUOTE_NONE))


def read_methods(ir_dir, methods_csv, hash_col, into, prefix=''):
    """hash -> qualified name, from one IR's method table. Returns its rows (or [])."""
    m = rows(os.path.join(ir_dir, methods_csv))
    if not m:
        return [], {}
    ix = {c: i for i, c in enumerate(m[0])}
    if hash_col not in ix:
        sys.stderr.write(f'{methods_csv} has no column {hash_col}; header is {m[0]}\n')
        raise SystemExit(2)
    for r in m[1:]:
        if len(r) <= ix[hash_col]:
            continue
        h = r[ix[hash_col]]
        qn = r[ix['qualifiedName']] if 'qualifiedName' in ix and len(r) > ix['qualifiedName'] else ''
        if not qn and 'name' in ix and len(r) > ix['name']:
            qn = r[ix['name']]
        if h and h not in into:
            into[h] = (prefix + qn) if qn else h
    return m, ix


def main() -> int:
    ir_dir, raw_dir, methods_csv, hash_col = sys.argv[1:5]
    lib_dirs = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--library' and i + 1 < len(sys.argv)]

    # method hash -> qualified name (falling back to the simple name, then the hash)
    name = {}
    m, ix = read_methods(ir_dir, methods_csv, hash_col, name)
    # A LIBRARY-DECLARED BASE IS THE INTERESTING HALF. `Runnable.run -> MyTask.run` is the
    # shape a client most often writes, and with only the client IR loaded the base printed
    # as a bare `lib:?` -- so a golden could not tell one library base from another, and a
    # rule that started fanning a DIFFERENT library method would not move it. The library
    # IR names them, by qualified name rather than by hash, so the golden stays portable.
    for d in lib_dirs:
        if os.path.isdir(d):
            read_methods(d, methods_csv, hash_col, name, prefix='lib:')

    # A qualified name is NOT unique. Java's enum-constant fan pairs an abstract method
    # with each constant's body, and every one of those is `<Enum>.<method>` — three
    # distinct hashes printing as one line, so a golden could not tell a fan of three from
    # a fan of one. Where a name is shared, the declaration line disambiguates it.
    _vals = list(name.values())
    shared = {q for q in _vals if _vals.count(q) > 1}
    line = {}
    if m:
        for r in m[1:]:
            if len(r) > ix[hash_col] and r[ix[hash_col]] and 'startLine' in ix and len(r) > ix['startLine']:
                line[r[ix[hash_col]]] = r[ix['startLine']]

    def label(h):
        # A LIBRARY method has no row in the client IR. Naming it `lib:<hash>` would put a
        # machine-specific hash in the golden, so it is named by what it is instead: the
        # pair still records that the envelope crosses the boundary, which is the fact
        # worth regressing on.
        q = name.get(h)
        # An `external:<type>.<name>` label is already a portable name (no library staged, so
        # the base is the label the call edge carries — basis `value`, #1206): print it as is.
        if not q and h.startswith('external:'):
            return h
        if not q:
            return 'lib:?'
        return f'{q}@{line.get(h, "?")}' if q in shared else q

    out = set()
    for r in rows(os.path.join(raw_dir, 'dispatch-candidates.csv'), rfc=False):
        if len(r) < 3:
            continue
        base, cand, basis = r[0], r[1], r[2]
        out.add(f'{basis}\t{label(base)} -> {label(cand)}')
    for s in sorted(out):
        print(s)
    return 0


if __name__ == '__main__':
    sys.exit(main())
