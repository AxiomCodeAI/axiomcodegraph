#!/usr/bin/env python3
"""Normalize <out>/field-access.csv into a stable, reviewable golden form.

One line per row:   <tier>\t<access>\tCaller#name(params) -> Owner#field
sorted, deduplicated. Hashes are resolved to names for exactly the reason normalize_edges.py
does it: a golden has to be readable and must not churn when a hash moves.

Reuses normalize_edges.Names, so a caller is named identically on both sides of every
comparison — nested-type chains, anonymous classes keyed by supertype, type variables erased.

  --oracle-pairs   emit the form tools/field_oracle.py emits, for the ground-truth diff:
                   `Caller#name(params) READ|WRITE Owner#field`, client-to-client only, with a
                   `readwrite` row expanded into its READ and its WRITE. A caller keyed by a TYPE
                   is a field initializer or an init block, which javac compiles into <init> /
                   <clinit>; the oracle excludes those by default, so they are dropped here too
                   rather than compared against a caller that does not exist on the other side.

usage: normalize_field_access.py <IR-dir> <OUT-dir> [<LIB-IR-dir>] [--oracle-pairs]
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_edges import Names, rows  # noqa: E402


def field_names(ir):
    """field hash -> Owner#name, for both ordinary fields and enum constants."""
    out = {}
    types = {t['typeRegistryUniqueHash']: t['qualifiedName'] for t in rows(f'{ir}/all-types.csv')}
    for r in rows(f'{ir}/all-fields.csv'):
        owner = r.get('ownerQualifiedName') or types.get(r.get('typeRegistryLinkHash'), '?')
        out[r['fieldRegistryUniqueHash']] = (owner, r['name'])
    for r in rows(f'{ir}/all-enum-constants.csv'):
        owner = r.get('ownerQualifiedName') or types.get(r.get('typeRegistryLinkHash'), '?')
        out[r['enumConstantUniqueHash']] = (owner, r['name'])
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    oracle_pairs = '--oracle-pairs' in sys.argv
    ir, out = args[0], args[1]
    n = Names(ir)
    fields = field_names(ir)
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
            for h, v in field_names(root).items():
                fields.setdefault(h, v)

    def fieldlabel(h):
        if h in ('-', ''):
            return '-'
        if h in fields:
            owner, name = fields[h]
            return f"{n.anon.get(owner, owner)}#{name}"
        # A GENERATED field is a label, not a hash: `generated:<type>#<name>`, a member an
        # annotation processor declares that no IR carries (resolution/generated-members.dl).
        # Printed whole, as normalize_edges.py does for the same reason: truncated to 24
        # characters two generated members on one type are the same string, so two rows
        # collapse into one golden line and a regression in either is invisible.
        if h.startswith('generated:'): return h
        return f"<unresolved:{h[:24]}>"

    path = f'{out}/field-access.csv'
    if not os.path.exists(path):
        return
    seen = set()
    for line in open(path, encoding='utf-8', errors='replace'):
        f = line.rstrip('\n').split('\t')
        if len(f) < 6:
            continue
        site, caller, field, prov, tier, access = f[:6]
        if oracle_pairs:
            if field == '-' or field not in fields or caller not in n.m:
                continue
            c = n.m[caller]
            for d in (['READ'] if access == 'read' else ['WRITE'] if access == 'write' else ['READ', 'WRITE']):
                seen.add(f"{c} {d} {fieldlabel(field)}")
        else:
            seen.add(f"{tier}\t{access}\t{n.label(caller)} -> {fieldlabel(field)}")
    for s in sorted(seen):
        print(s)


if __name__ == '__main__':
    main()
