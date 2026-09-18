#!/usr/bin/env python3
"""Score type_use against the bytecode ground truth, at project scale.

    score_type_use.py <IR-dir> <RAW-dir> <oracle-file> [--debug-info <file>] [--label NAME]

Both sides are reduced to the key tools/type_use_oracle.py emits:

    DeclaringClass CONTEXT qualified.Type

which is the granularity a class file can answer: it records the descriptors and signatures of
its own members, not which of two same-typed parameters a reference belonged to. `type_use` is
finer and is scored here at the coarser key, so the number says whether the engine finds the
(owner, context, type) triples the compiler recorded.

SCORED CONTEXTS are the ones the bytecode carries at all. An engine row in any other context is
counted and not charged to either side, because the class file has nothing to compare it with:

  * ANNOTATION_TYPE / ANNOTATION_PARAM — an annotation's types live in an attribute javap prints
    as constant-pool indices, and a SOURCE-retention annotation is not in the file at all.
  * PATTERN_BINDING_TYPE / SWITCH_TYPE_PATTERN / RECORD_PATTERN_TYPE / METHOD_REFERENCE_QUALIFIER
    / METHOD_TYPE_ARGUMENT — each compiles to an instruction or a table entry that the reader
    already counts under a DIFFERENT context (a checkcast, a local), so scoring them here would
    charge the engine for a context difference rather than for a missing type.

NOT SCORED EITHER, on both sides:
  * a type outside the client. The oracle runs --app-only and an engine row whose type is not a
    client type is dropped, so neither side is charged for a JDK type the other cannot see.
  * a class the build did not compile.
  * a LOCAL_VARIABLE in a class compiled without -g. There is no LocalVariableTable in such a
    class file, so the bytecode records no local's type; --debug-info takes the oracle's list of
    classes that carry one and LOCAL_VARIABLE is scored only inside it. joda-time is built this
    way in full, and without the exclusion its precision reads 0.861 rather than what it is.
"""
import collections, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_edges import Names, rows  # noqa: E402

SCORED = {'SUPER_TYPE', 'IMPLEMENTS_INTERFACE', 'FIELD_TYPE', 'METHOD_PARAM', 'METHOD_RETURN',
          'THROWS_CLAUSE', 'LOCAL_VARIABLE', 'OBJECT_CREATION_TYPE', 'ARRAY_CREATION_TYPE',
          'CAST_EXPRESSION', 'INSTANCEOF_TYPE', 'TYPE_PARAM_BOUND', 'METHOD_TYPE_PARAM_BOUND'}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    ir, raw, oracle_path = args[0], args[1], args[2]
    label = sys.argv[sys.argv.index('--label') + 1] if '--label' in sys.argv else os.path.basename(os.path.dirname(ir))
    n = Names(ir)
    client_types = set(n.types)

    def typelabel(h):
        q = n.types[h]
        return n.anon.get(q, q)

    debug_info = None
    if '--debug-info' in sys.argv:
        debug_info = {l.strip() for l in open(sys.argv[sys.argv.index('--debug-info') + 1]) if l.strip()}
    oracle = {l.rstrip('\n') for l in open(oracle_path) if l.strip()}
    oracle_classes = {l.split(' ', 1)[0] for l in oracle}

    engine = set()
    refs = set()
    resolved = set()
    tiers = collections.Counter()
    contexts = collections.Counter()
    unscored_context = 0
    unbuilt = 0
    no_debug = 0
    for line in open(os.path.join(raw, 'type-use.csv'), encoding='utf-8', errors='replace'):
        f = line.rstrip('\n').split('\t')
        if len(f) < 10:
            continue
        ref, owner, ownerKind, enclType, enclMethod, t, prov, ctx, depth, tier = f[:10]
        refs.add(ref)
        tiers[tier] += 1
        contexts[ctx] += 1
        if t != '-':
            resolved.add(ref)
        if t == '-' or t not in client_types or enclType not in client_types:
            continue
        if ctx not in SCORED:
            unscored_context += 1
            continue
        c = typelabel(enclType)
        if c not in oracle_classes:
            unbuilt += 1
            continue
        if ctx == 'LOCAL_VARIABLE' and debug_info is not None and c not in debug_info:
            no_debug += 1
            continue
        engine.add(f"{c} {ctx} {typelabel(t)}")

    ir_classes = {typelabel(h) for h in client_types}
    oracle = {l for l in oracle if l.split(' ', 1)[0] in ir_classes}
    if debug_info is not None:
        oracle = {l for l in oracle
                  if ' LOCAL_VARIABLE ' not in l or l.split(' ', 1)[0] in debug_info}

    tp = len(engine & oracle)
    fp = len(engine - oracle)
    fn = len(oracle - engine)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    print(f"{label}")
    print(f"  precision {prec:.4f}   ({tp} correct, {fp} wrong)")
    print(f"  recall    {rec:.4f}   ({tp} of {tp + fn} in the bytecode)")
    print(f"  references {len(refs)}   resolved {len(resolved)} "
          + (f"({len(resolved) / len(refs) * 100:.1f}%)" if refs else ""))
    print("  tiers " + "  ".join(f"{k}={v}" for k, v in sorted(tiers.items())))
    print(f"  not scored: {unscored_context} in a context the bytecode does not carry, "
          f"{unbuilt} in a class the build did not compile, "
          f"{no_debug} local in a class compiled without -g")
    print("  contexts " + "  ".join(f"{k}={v}" for k, v in sorted(contexts.items())))
    if '--show-wrong' in sys.argv:
        for s in sorted(engine - oracle)[:40]:
            print(f"    WRONG   {s}")
    if '--show-missing' in sys.argv:
        for s in sorted(oracle - engine)[:40]:
            print(f"    MISSING {s}")


if __name__ == '__main__':
    main()
