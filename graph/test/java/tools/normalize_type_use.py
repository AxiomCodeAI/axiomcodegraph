#!/usr/bin/env python3
"""Normalize <out>/type-use.csv into a stable, reviewable golden form.

One line per row:  <tier>\t<context>\t<depth>\tOwner -> Type
sorted, deduplicated. Owner is the enclosing declaration as the edge goldens name it
(Class#method(params), or the class alone where the reference has no enclosing method),
followed by the owner KIND in brackets so a parameter's reference is not confused with the
method's own return.

Reuses normalize_edges.Names, so a type and a method are named identically on both sides of
every comparison.

  --oracle-triples   emit the form tools/type_use_oracle.py emits, for the ground-truth diff:
                     `DeclaringClass CONTEXT qualified.Type`, deduplicated. That granularity is
                     what the bytecode can answer: a class file records the descriptors and
                     signatures of its own members, not which of two same-typed parameters a
                     reference belonged to.

usage: normalize_type_use.py <IR-dir> <OUT-dir> [<LIB-IR-dir>] [--oracle-triples]
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_edges import Names  # noqa: E402


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    triples = '--oracle-triples' in sys.argv
    ir, out = args[0], args[1]
    n = Names(ir)
    if len(args) > 2 and os.path.isdir(args[2]):
        roots = [args[2]] if os.path.exists(os.path.join(args[2], 'all-methods.csv')) else \
                [os.path.join(args[2], d) for d in sorted(os.listdir(args[2]))
                 if os.path.exists(os.path.join(args[2], d, 'all-methods.csv'))]
        for root in roots:
            lib = Names(root)
            for h, label in lib.m.items():
                n.m.setdefault(h, label)
            for h, qn in lib.types.items():
                n.types.setdefault(h, qn)

    def typelabel(h):
        if h in ('-', ''):
            return '-'
        if h in n.types:
            q = n.types[h]
            return n.anon.get(q, q)
        if h.startswith('external:'):
            return h
        return f"<unresolved:{h[:24]}>"

    path = f'{out}/type-use.csv'
    if not os.path.exists(path):
        return
    seen = set()
    for line in open(path, encoding='utf-8', errors='replace'):
        f = line.rstrip('\n').split('\t')
        if len(f) < 10:
            continue
        ref, owner, ownerKind, enclType, enclMethod, t, prov, ctx, depth, tier = f[:10]
        cls = typelabel(enclType)
        if triples:
            if t == '-' or t not in n.types:
                continue
            seen.add(f"{cls} {ctx} {typelabel(t)}")
        else:
            where = n.m.get(enclMethod) or cls
            seen.add(f"{tier}\t{ctx}\t{depth}\t{where} [{ownerKind}] -> {typelabel(t)}")
    for s in sorted(seen):
        print(s)


if __name__ == '__main__':
    main()
