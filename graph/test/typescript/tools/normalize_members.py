#!/usr/bin/env python3
"""Normalize <out>/field-access.csv and <out>/type-use.csv into reviewable goldens.

    normalize_members.py --fields <IR> <OUT> [--lib-ir D] [--oracle-pairs]
    normalize_members.py --types  <IR> <OUT> [--lib-ir D] [--oracle-pairs]

Golden form:
    fields   <tier>\t<access>\tCaller -> Owner#prop
    types    <tier>\t<context>\t<depth>\tOwner [kind] -> Type

`--oracle-pairs` emits what tools/tsc_member_oracle.mjs emits, for the ground-truth diff:
    fields   `Caller READ|WRITE Owner#prop`, with a `readwrite` row expanded into both
    types    `Owner USES Type`, WITHOUT the context — see that file for why the compiler
             cannot corroborate a context and this refuses to invent one.

Reuses normalize_edges.Names so a caller is labelled identically on both sides.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_edges import Names, rows  # noqa: E402


def field_names(ir, prefix='typescript'):
    """field hash -> (owner label, name), for the fields table."""
    out = {}
    types = {t['tsTypeUniqueHash']: (t.get('name') or t.get('qualifiedName') or '?')
             for t in rows(f'{ir}/all-{prefix}-types.csv')}
    for r in rows(f'{ir}/all-{prefix}-fields.csv'):
        owner = types.get(r.get('tsTypeLinkHash')) or r.get('ownerTypeName') or '?'
        # `static ` prefixes the NAME, as normalize_edges.Names does for a static method and
        # as the compiler side's labelOf does. Without it a static member is named one way on
        # each side and every access to it scores as both a miss and a false positive.
        name = ('static ' if r.get('isStatic') == 'true' else '') + r['name']
        out[r['tsFieldUniqueHash']] = (owner, name)
    return out


def type_names(ir, prefix='typescript'):
    return {t['tsTypeUniqueHash']: (t.get('name') or t.get('qualifiedName') or '?')
            for t in rows(f'{ir}/all-{prefix}-types.csv')}


def main():
    argv = sys.argv[1:]
    mode = 'fields' if '--fields' in argv else 'types'
    pairs = '--oracle-pairs' in argv
    lib_ir = None
    if '--lib-ir' in argv:
        i = argv.index('--lib-ir')
        lib_ir = argv[i + 1]
        del argv[i:i + 2]
    args = [a for a in argv if not a.startswith('--')]
    ir, out = args[0], args[1]
    n = Names(ir, lib_ir)
    fields = field_names(ir)
    types = type_names(ir)
    if lib_ir and os.path.isdir(lib_ir):
        fields.update({k: v for k, v in field_names(lib_ir).items() if k not in fields})
        types.update({k: v for k, v in type_names(lib_ir).items() if k not in types})

    seen = set()
    if mode == 'fields':
        path = f'{out}/field-access.csv'
        if not os.path.exists(path):
            return
        for line in open(path, encoding='utf-8', errors='replace'):
            f = line.rstrip('\n').split('\t')
            if len(f) < 6:
                continue
            site, caller, field, prov, tier, access = f[:6]
            target = '-' if field == '-' else (
                f"{fields[field][0]}#{fields[field][1]}" if field in fields
                else f"<unresolved:{field[:24]}>")
            if pairs:
                if field == '-' or field not in fields:
                    continue
                for d in (['READ'] if access == 'read' else ['WRITE'] if access == 'write'
                          else ['READ', 'WRITE']):
                    seen.add(f"{n.label(caller)} {d} {target}")
            else:
                seen.add(f"{tier}\t{access}\t{n.label(caller)} -> {target}")
    else:
        path = f'{out}/type-use.csv'
        if not os.path.exists(path):
            return
        for line in open(path, encoding='utf-8', errors='replace'):
            f = line.rstrip('\n').split('\t')
            if len(f) < 10:
                continue
            ref, owner, ownerKind, enclType, enclMethod, t, prov, ctx, depth, tier = f[:10]
            target = '-' if t == '-' else types.get(t, f"<unresolved:{t[:24]}>")
            where = types.get(enclType) or (n.label(enclMethod).split('#')[0]
                                            if enclMethod != '-' else '-')
            if pairs:
                if t == '-' or t not in types:
                    continue
                seen.add(f"{where} USES {target}")
            else:
                seen.add(f"{tier}\t{ctx}\t{depth}\t{where} [{ownerKind}] -> {target}")
    for s in sorted(seen):
        print(s)


if __name__ == '__main__':
    main()
