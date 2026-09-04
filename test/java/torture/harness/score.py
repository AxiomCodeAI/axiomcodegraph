#!/usr/bin/env python3
"""Per-FAMILY coverage for the Java torture project, against the class-file oracle.

Why per family and not one number: an aggregate that says "94%" tells you nothing about WHICH
construct is unsupported, and a construct is what a fix is written against. Every file here is one
family, every caller's type carries the family's prefix, so an edge attributes itself.

Verdicts, per family:
  found    the oracle's edge is in the graph
  precise  the engine named a SUBTYPE of the bytecode owner — the method that actually runs.
           Bytecode records the receiver's STATIC type, so `Base b = new Unit(); b.area()` is
           recorded as Base#area while the engine, having flow-typed the variable, answers
           Unit#area. Neither is wrong, and folding it into `missed` would report the engine as
           having lost an edge at exactly the moment it got sharper.
  ancestor the engine named a SUPERTYPE — where the method is declared. Also not an error.
  missed   nothing of that signature anywhere in the receiver's hierarchy — bytecode's declared
           targets are facts, so this is a defect
  wide     an edge the engine emits that the oracle does not. Where dispatch is genuinely ambiguous
           the engine emits the SOUND SET, so a superset is expected; it is reported, never failed,
           and it must not grow unnoticed, which is what the golden is for.

The oracle cannot see everything the source contains, and that is a property of bytecode rather
than of the engine: an annotation is not an invoke instruction, so f05 has almost no bytecode-
visible edges at all. Its coverage is scored from the CONFIG relations instead, which is where an
annotation's meaning lands.

usage: score.py <client-ir> <engine-out> <engine-pairs> <oracle-edges> [--config <out>]
"""
import collections, os, re, sys

FAMILIES = {
    'F01': 'polymorphism & dispatch', 'F02': 'generics & substitution', 'F03': 'var inference',
    'F04': 'event-driven dispatch',   'F05': 'annotations (config)',    'F06': 'lambdas & method refs',
    'F07': 'records/sealed/enums',    'F08': 'nesting & outward calls', 'F09': 'declared blind spots',
    'F10': 'value flow',
}


def fam(caller):
    m = re.search(r'\bF(\d\d)', caller)
    return 'F' + m.group(1) if m and 'F' + m.group(1) in FAMILIES else None


def ancestors_of(ir, out):
    """(sub -> {ancestors}) by flattened name, from the engine's own type_ancestor export. Flattened
    the way normalize_edges names a type, so both sides of every comparison agree."""
    import csv
    name = {}
    p = os.path.join(ir, 'all-types.csv')
    if os.path.exists(p):
        with open(p, newline='', encoding='utf-8', errors='replace') as f:
            r = csv.reader(f, delimiter='\t'); h = next(r)
            i, j = h.index('typeRegistryUniqueHash'), h.index('qualifiedName')
            for x in r:
                if len(x) > max(i, j):
                    q = x[j]; pkg = q[:q.rindex('.')] if '.' in q else ''
                    name[x[i]] = (pkg + '.' if pkg else '') + q.split('.')[-1].split('$')[-1]
    anc = collections.defaultdict(set)
    p = os.path.join(out, 'resolution-type-ancestor.csv')
    if os.path.exists(p):
        for line in open(p, encoding='utf-8', errors='replace'):
            c = line.rstrip('\n').split('\t')
            if len(c) >= 2 and c[0] in name and c[1] in name: anc[name[c[0]]].add(name[c[1]])
    return anc


def norm(line):
    """One normalisation, applied to both sides — the two conventions that cannot be compared.

    A CONSTRUCTOR's parameter list is not comparable: javac gives a constructor parameters the
    source never writes (an inner class's enclosing instance, a local or anonymous class's captured
    variables), so `new Inner()` is `Inner(Outer)` in bytecode. Compared at name level, as
    oracle_diff.py does for the same reason; the exact list is still pinned in torture.edges.

    A caller keyed by the owning TYPE is a call written in a FIELD INITIALIZER, which javac compiles
    into the constructor — bytecode attributes it to `<init>`, so that is what it is called here."""
    line = line.strip()
    if '->' not in line: return None
    a, b = [x.strip() for x in line.split('->', 1)]
    a = re.sub(r'\([^)]*\)$', '', a).replace('#<type-initializer>', '#<init>')
    if '#<init>(' in b: b = re.sub(r'\([^)]*\)$', '', b)
    return a + ' -> ' + b


def main():
    _ir, out, pairs, oracle = sys.argv[1:5]
    eng = {x for x in (norm(l) for l in open(pairs)) if x}
    orc = {x for x in (norm(l) for l in open(oracle)) if x}

    anc = ancestors_of(_ir, out)
    by_caller_sig = collections.defaultdict(set)      # (caller, "#name(params)") -> {owner}
    for e in eng:
        a, b = e.split(' -> ', 1)
        if '#' in b: by_caller_sig[(a, b[b.index('#'):])].add(b[:b.index('#')])

    found = collections.Counter(); missed = collections.Counter(); wide = collections.Counter()
    precise = collections.Counter(); ancestor = collections.Counter()
    miss_rows = collections.defaultdict(list); ok_other = set()
    for e in sorted(orc):
        a, b = e.split(' -> ', 1)
        f = fam(a)
        if not f: continue
        if e in eng: found[f] += 1; continue
        owner = b[:b.index('#')] if '#' in b else ''
        got = by_caller_sig.get((a, b[b.index('#'):]), set()) if '#' in b else set()
        if any(owner in anc.get(g, ()) for g in got):
            precise[f] += 1
            ok_other |= {f'{a} -> {g}{b[b.index("#"):]}' for g in got if owner in anc.get(g, ())}
        elif any(g in anc.get(owner, ()) for g in got):
            ancestor[f] += 1
            ok_other |= {f'{a} -> {g}{b[b.index("#"):]}' for g in got if g in anc.get(owner, ())}
        else:
            missed[f] += 1
            if len(miss_rows[f]) < 6: miss_rows[f].append(e)
    for e in sorted(eng - orc):
        if e in ok_other: continue          # already counted as precise/ancestor, not as extra
        f = fam(e.split(' -> ')[0])
        if f: wide[f] += 1

    # f05 is scored on config rows: an annotation emits no invoke instruction, so bytecode has
    # nothing to say about it. Beans, injection points, entry points and bindings are its output.
    cfg = collections.Counter()
    for name in ('config-bean-def', 'config-di-edge', 'config-entry-point', 'config-inject-point',
                 'config-binding', 'config-class-ref', 'config-unresolved'):
        p = os.path.join(out, name + '.csv')
        if os.path.exists(p):
            cfg[name] = sum(1 for l in open(p, encoding='utf-8', errors='replace') if l.strip())

    print('=== java torture: per-family coverage against the class-file oracle ===')
    tf = tm = tw = tp = ta = 0
    for k in sorted(FAMILIES):
        f, m, w, p, an = found[k], missed[k], wide[k], precise[k], ancestor[k]
        tf += f; tm += m; tw += w; tp += p; ta += an
        tot = f + m + p + an
        ok = f + p + an
        pct = f'{100*ok/tot:5.1f}%' if tot else '    --'
        print(f'  {k} {FAMILIES[k]:<26} edges={tot:>3}  answered={ok:>3} ({pct})  '
              f'exact={f:>3} precise={p:>2} ancestor={an:>2}  MISSED={m:>2}  wide={w:>3}')
    tot = tf + tm + tp + ta; ok = tf + tp + ta
    print(f'  {"TOTAL":<31} edges={tot:>3}  answered={ok:>3} ({100*ok/tot:5.1f}%)  '
          f'exact={tf:>3} precise={tp:>2} ancestor={ta:>2}  MISSED={tm:>2}  wide={tw:>3}')
    print()
    print('  f05 is scored on config rows, not on invoke instructions:')
    for k in sorted(cfg):
        print(f'    {k:<22} {cfg[k]:>4}')
    if tm:
        print()
        print('  MISSED (the oracle has it, the graph does not):')
        for k in sorted(miss_rows):
            for r in sorted(miss_rows[k]): print(f'    {k} {r}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
