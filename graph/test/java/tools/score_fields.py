#!/usr/bin/env python3
"""Score field_access against the bytecode ground truth, at project scale.

    score_fields.py <IR-dir> <RAW-dir> <oracle-file> [--inlined <file>] [--library <dir>] [--label NAME]

The oracle file is tools/field_oracle.py's output over the project's OWN compiled classes.
Both sides are reduced to the same key:

    Caller#name(params) READ|WRITE Owner#field

and the score is over the INTERSECTION OF THE COMPARABLE UNIVERSE, which is the part of this
that is easy to get wrong and expensive to get wrong:

  * CLIENT to CLIENT only. The oracle is run --app-only, and an engine row whose field is not
    declared in the client IR is dropped, so neither side is charged for a JDK field the other
    cannot see.
  * CONSTRUCTORS ARE SCORED, initializer BLOCKS are not. The oracle is run
    --with-initializers, so `<init>` is a caller on both sides and the constructor field writes
    -- a large share of every project's writes -- are measured rather than thrown away. What
    cannot be compared is code with no enclosing method at all: a field initializer or a
    static/instance init block, which javac compiles INTO <init>/<clinit> while the IR attributes
    it to the enclosing TYPE. Every engine row whose caller is a type hash is therefore removed,
    and every oracle <clinit> row with it. An oracle <init> row that came from a field
    initializer survives and is counted as a MISS, which biases recall down and never precision
    up. Both removals are PRINTED, because an exclusion nobody can see is one nobody can check.
  * A COMPILE-TIME CONSTANT is not scored. `static final int N = 32;` is inlined at every use,
    so no instruction names it and the bytecode cannot say the source read it. --inlined takes
    field_oracle.py's --inlined-out list and drops those accesses from the ENGINE side, which is
    the only side that has them. Printed.
  * A LAMBDA BODY IS FOLDED, so its caller's parameters are `*` on the oracle side (javac names
    the body `lambda$m$0` and its descriptor is not m's). The engine attributes an access inside
    a lambda to the enclosing method with that method's real signature, so the two keys can never
    match. Where the oracle emitted a `(*)` caller, BOTH sides' keys for that (class, method) are
    rewritten to `(*)`: a symmetric relaxation of caller granularity, applied only to methods
    that contain a lambda, and never to one side alone.
  * A `<clinit>` CALLER is dropped on both sides, for the initializer reason above.
  * A CALLER NEITHER SIDE KNOWS ABOUT is not scored either: if the class does not appear in the
    oracle at all (a source file the build did not compile, generated sources, a module the
    build skipped) the engine is not charged for it. Printed too.

Precision is the metric that matters and is printed first: a wrong field edge makes an impact
answer confidently wrong, while a missing one makes it a lower bound, which the tier system
already says it may be.

Also reported: the RESOLVED FRACTION of the site population — how many field-access sites the
engine found, and how many of them carry a resolved field rather than a declared unknown. That
is the denominator issue #663 quotes (55,092 FIELD-stamped rows in rocketmq), measured here.
"""
import collections, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_edges import Names, rows  # noqa: E402
from normalize_field_access import field_names  # noqa: E402


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    ir, raw, oracle_path = args[0], args[1], args[2]
    label = sys.argv[sys.argv.index('--label') + 1] if '--label' in sys.argv else os.path.basename(os.path.dirname(ir))
    n = Names(ir)
    fields = field_names(ir)
    if '--library' in sys.argv:
        root = sys.argv[sys.argv.index('--library') + 1]
        roots = [root] if os.path.exists(os.path.join(root, 'all-methods.csv')) else \
                [os.path.join(root, d) for d in sorted(os.listdir(root))
                 if os.path.exists(os.path.join(root, d, 'all-methods.csv'))]
        for r in roots:
            lib = Names(r)
            n.m.update({h: v for h, v in lib.m.items() if h not in n.m})

    def fieldlabel(h):
        owner, name = fields[h]
        return f"{n.anon.get(owner, owner)}#{name}"

    inlined = set()
    if '--inlined' in sys.argv:
        inlined = {l.strip() for l in open(sys.argv[sys.argv.index('--inlined') + 1]) if l.strip()}
    oracle = {l.rstrip('\n') for l in open(oracle_path) if l.strip()}
    oracle_classes = {l.split('#', 1)[0] for l in oracle}
    clinit = {l for l in oracle if l.split(' ', 1)[0].endswith('#<clinit>()')}
    oracle -= clinit
    # the (class, method) pairs whose accesses the oracle could only attribute with `*` params
    lambda_callers = {l.split(' ', 1)[0].split('(', 1)[0] for l in oracle if l.split(' ', 1)[0].endswith('(*)')}

    def fold(key):
        caller, rest = key.split(' ', 1)
        head = caller.split('(', 1)[0]
        return f"{head}(*) {rest}" if head in lambda_callers else key

    oracle = {fold(l) for l in oracle}

    engine = set()
    sites = set()
    resolved_sites = set()
    tiers = collections.Counter()
    access = collections.Counter()
    skipped_initializer = 0
    skipped_unbuilt = 0
    skipped_inlined = 0
    path = os.path.join(raw, 'field-access.csv')
    for line in open(path, encoding='utf-8', errors='replace'):
        f = line.rstrip('\n').split('\t')
        if len(f) < 6:
            continue
        site, caller, field, prov, tier, acc = f[:6]
        sites.add(site)
        tiers[tier] += 1
        access[site] = acc
        if field != '-':
            resolved_sites.add(site)
        if field == '-' or field not in fields:
            continue                       # unresolved, or a library field: not client-to-client
        if caller not in n.m:
            skipped_initializer += 1       # caller is a TYPE: <clinit>/<init>, not in the oracle
            continue
        c = n.m[caller]
        if c.endswith('#<clinit>()'):
            skipped_initializer += 1
            continue
        if fieldlabel(field) in inlined:
            skipped_inlined += 1
            continue
        if c.split('#', 1)[0] not in oracle_classes:
            skipped_unbuilt += 1           # the build did not compile this class
            continue
        for d in (['READ'] if acc == 'read' else ['WRITE'] if acc == 'write' else ['READ', 'WRITE']):
            engine.add(fold(f"{c} {d} {fieldlabel(field)}"))
    # the oracle side is restricted the same way: only classes the IR knows
    ir_classes = {v.split('#', 1)[0] for v in n.m.values()}
    oracle = {l for l in oracle if l.split('#', 1)[0] in ir_classes}

    tp = len(engine & oracle)
    fp = len(engine - oracle)
    fn = len(oracle - engine)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    print(f"{label}")
    print(f"  precision {prec:.4f}   ({tp} correct, {fp} wrong)")
    print(f"  recall    {rec:.4f}   ({tp} of {tp + fn} in the bytecode)")
    print(f"  sites {len(sites)}   resolved {len(resolved_sites)} "
          f"({len(resolved_sites) / len(sites) * 100:.1f}%)" if sites else "  sites 0")
    print("  tiers " + "  ".join(f"{k}={v}" for k, v in sorted(tiers.items())))
    print("  access " + "  ".join(f"{k}={v}" for k, v in sorted(collections.Counter(access.values()).items())))
    print(f"  not scored: {skipped_initializer} initializer-owned, {skipped_unbuilt} in a class the build did not compile, "
          f"{len(clinit)} oracle rows in a static initializer, {skipped_inlined} reads of an inlined constant")
    if '--show-wrong' in sys.argv:
        for s in sorted(engine - oracle)[:40]:
            print(f"    WRONG   {s}")
    if '--show-missing' in sys.argv:
        for s in sorted(oracle - engine)[:40]:
            print(f"    MISSING {s}")


if __name__ == '__main__':
    main()
