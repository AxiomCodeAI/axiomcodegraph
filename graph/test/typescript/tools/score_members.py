#!/usr/bin/env python3
"""Score field_access and type_use against the TypeScript compiler.

    score_members.py --fields|--types <IR> <RAW> <oracle-file> [--lib-ir D] [--label N]

Both sides are reduced to the key tools/tsc_member_oracle.mjs emits:

    fields   Caller READ|WRITE Owner#prop
    types    Owner USES Type

NOT SCORED, on both sides:
  * a member or type outside the client. The oracle emits only declarations in the case's
    own sources, and an engine row whose target is not in the client IR is dropped, so
    neither side is charged for a library declaration the other cannot see.
  * an ACCESSOR read. It is a CALL, scored by tools/tsc_oracle_case.mjs as a
    PROPERTY_READ / PROPERTY_WRITE edge; the engine makes the same cut.
  * the CONTEXT of a type use. See tsc_member_oracle.mjs: the compiler has no notion to
    corroborate the parser's 33-value context vocabulary with, and scoring the engine
    against a mapping invented in a test tool is not scoring it against the language.

Precision is printed first: a wrong edge makes an impact answer confidently wrong, while
a missing one makes it a lower bound, which the tier already says it may be.
"""
import collections, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_edges import Names  # noqa: E402
from normalize_members import field_names, type_names  # noqa: E402


def main():
    argv = sys.argv[1:]
    mode = 'fields' if '--fields' in argv else 'types'
    lib_ir = None
    if '--lib-ir' in argv:
        i = argv.index('--lib-ir')
        lib_ir = argv[i + 1]
        del argv[i:i + 2]
    label = 'case'
    if '--label' in argv:
        i = argv.index('--label')
        label = argv[i + 1]
        del argv[i:i + 2]
    args = [a for a in argv if not a.startswith('--')]
    ir, raw, oracle_path = args[0], args[1], args[2]
    n = Names(ir, lib_ir)
    fields = field_names(ir)
    types = type_names(ir)

    oracle = {l.rstrip('\n') for l in open(oracle_path) if l.strip()}
    engine = set()
    sites = set()
    resolved = set()
    tiers = collections.Counter()
    extra = collections.Counter()
    not_client = 0

    if mode == 'fields':
        for line in open(os.path.join(raw, 'field-access.csv'), encoding='utf-8', errors='replace'):
            f = line.rstrip('\n').split('\t')
            if len(f) < 6:
                continue
            site, caller, field, prov, tier, access = f[:6]
            sites.add(site)
            tiers[tier] += 1
            extra[access] += 1
            if field != '-':
                resolved.add(site)
            if field == '-' or field not in fields:
                not_client += 1
                continue
            t = f"{fields[field][0]}#{fields[field][1]}"
            for d in (['READ'] if access == 'read' else ['WRITE'] if access == 'write'
                      else ['READ', 'WRITE']):
                engine.add(f"{n.label(caller)} {d} {t}")
    else:
        for line in open(os.path.join(raw, 'type-use.csv'), encoding='utf-8', errors='replace'):
            f = line.rstrip('\n').split('\t')
            if len(f) < 10:
                continue
            ref, owner, ownerKind, enclType, enclMethod, t, prov, ctx, depth, tier = f[:10]
            sites.add(ref)
            tiers[tier] += 1
            extra[ctx] += 1
            if t != '-':
                resolved.add(ref)
            if t == '-' or t not in types:
                not_client += 1
                continue
            where = types.get(enclType) or (n.label(enclMethod).split('#')[0]
                                            if enclMethod != '-' else None)
            if where is None:
                not_client += 1
                continue
            engine.add(f"{where} USES {types[t]}")

    tp = len(engine & oracle)
    fp = len(engine - oracle)
    fn = len(oracle - engine)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    print(f"{label} [{mode}]")
    print(f"  precision {prec:.4f}   ({tp} correct, {fp} wrong)")
    print(f"  recall    {rec:.4f}   ({tp} of {tp + fn} the compiler resolved)")
    print(f"  sites {len(sites)}   resolved {len(resolved)} "
          + (f"({len(resolved) / len(sites) * 100:.1f}%)" if sites else ""))
    print("  tiers " + "  ".join(f"{k}={v}" for k, v in sorted(tiers.items())))
    print(f"  {'access' if mode == 'fields' else 'contexts'} "
          + "  ".join(f"{k}={v}" for k, v in sorted(extra.items())))
    print(f"  not scored: {not_client} rows whose target is not a client declaration")
    if '--show-wrong' in sys.argv:
        for s in sorted(engine - oracle)[:40]:
            print(f"    WRONG   {s}")
    if '--show-missing' in sys.argv:
        for s in sorted(oracle - engine)[:40]:
            print(f"    MISSING {s}")


if __name__ == '__main__':
    main()
