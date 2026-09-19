#!/usr/bin/env python3
"""
Engine invariants, checked per case against the raw output and the IR.

WHY THIS IS NOT PART OF THE SCORE. The score compares the engine with the Roslyn
oracle, and there are true things about the output that the oracle has no opinion
about. A call through `dynamic` is the clearest: Roslyn cannot bind it either, so it
writes NO ground-truth row, and every verdict the score can reach -- coverage,
agreement, fan -- is blind to whether the engine answered `ambiguous_dynamic`,
`ambiguous_unknown` or `boundary_lib` there. All three score identically. Only one of
them is true.

WHY IT IS NOT A BLESSED GOLDEN EITHER. A `.expected` file records what the engine did
on the day it was blessed, so a rule that is wrong in the same way as the file passes
forever, and the quickest way past a red check is to re-bless. Nothing here is
generated from a run: each invariant is a written claim with its reasoning, and
changing it means arguing with the reasoning.

These hold for EVERY case, not just the one that motivated them.

    engine-invariants.py <engine-raw-dir> <engine-ir-dir> [--label NAME]

Exit status: 0 if every invariant holds, 1 otherwise.
"""
import csv
import os
import sys

# The tier vocabulary, from call-edge-generation/call_chain.dl. A tier absent from
# this list is either a typo or a new confidence claim nobody documented, and both
# are worth failing on: a consumer filters on these strings.
TIERS = {
    "known_edge", "multi_inferred", "fan_capped", "boundary_lib",
    "boundary_generated", "ambiguous_unknown", "ambiguous_dynamic",
    "known_implicit_ctor", "known_builtin_operator", "runtime_observed",
}

# A predefined alias that denotes NO TYPE. Every other name in the engine's alias
# list (`string`, `int`, `object`) is a real framework type the client did not stage,
# so `external:string.Trim` names where the call went. `dynamic` is the DLR being
# asked at runtime; there is no type and no member to name.
NOT_A_TYPE = {"dynamic"}


def read_raw(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        return [r for r in csv.reader(fh, delimiter="\t") if r]


def read_ir(ir_dir, name):
    path = os.path.join(ir_dir, name)
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


def dynamic_receiver_sites(ir_dir):
    """
    Every call site written on a receiver whose DECLARATION says `dynamic`.

    Taken from the declarations rather than from the call kind on purpose: the
    parser's DYNAMIC_CALL kind is reserved with zero rows, so a check keyed on it
    would pass vacuously on a file full of `dynamic`.

    The receiver is matched by its written NAME within the declaring method, which is
    what the parser records on the site (`receiverTypeName` holds the receiver's
    written text for a NAME receiver). That is exact for the shape this guards --
    a local, a parameter, a field or a property called through -- and deliberately
    does not try to follow an expression: a check that silently stops matching is
    worse than one that matches a stated subset.
    """
    dyn_by_method, dyn_by_type = {}, {}
    for r in read_ir(ir_dir, "all-csharp-variables.csv"):
        if r.get("variableTypeName") == "dynamic":
            dyn_by_method.setdefault(r.get("csMethodLinkHash", ""), set()).add(r["name"])
    for r in read_ir(ir_dir, "all-csharp-method-parameters.csv"):
        if r.get("typeName") == "dynamic":
            dyn_by_method.setdefault(r.get("csMethodLinkHash", ""), set()).add(r["name"])
    for kind, col in (("all-csharp-fields.csv", "fieldTypeName"),
                      ("all-csharp-properties.csv", "propertyTypeName")):
        for r in read_ir(ir_dir, kind):
            if r.get(col) == "dynamic":
                dyn_by_type.setdefault(r.get("csTypeLinkHash", ""), set()).add(r["name"])

    sites = set()
    for r in read_ir(ir_dir, "all-csharp-call-sites.csv"):
        recv = r.get("receiverTypeName") or ""
        if not recv:
            continue
        in_method = dyn_by_method.get(r.get("callerMethodLinkHash", ""), ())
        in_type = dyn_by_type.get(r.get("callerTypeLinkHash", ""), ())
        if recv in in_method or recv in in_type:
            sites.add(r["csExpressionLinkHash"])
    return sites


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    label = ""
    if "--label" in sys.argv:
        label = sys.argv[sys.argv.index("--label") + 1]
    if len(args) < 2:
        sys.exit("usage: engine-invariants.py <engine-raw> <engine-ir> [--label NAME]")
    raw, ir_dir = args[0], args[1]

    failures = []

    # ── 1. NO EXTERNAL LABEL NAMES SOMETHING THAT IS NOT A TYPE ──────────────
    # `boundary_lib` means client to library and is the tier a consumer FOLLOWS into
    # a staged dependency. A label of `external:dynamic.Describe` asserts a type
    # called `dynamic` with that member; staged against any library it would try to
    # link to a type nothing declares.
    for row in read_raw(os.path.join(raw, "call-edges-external.csv")):
        if len(row) < 2:
            continue
        name = row[1].split("external:", 1)[-1].split(".", 1)[0]
        if name in NOT_A_TYPE:
            failures.append(f"external label names a non-type: {row[1]}")
    for row in read_raw(os.path.join(raw, "external-property-read.csv")):
        if len(row) < 3:
            continue
        name = row[2].split("external:", 1)[-1].split(".", 1)[0]
        if name in NOT_A_TYPE:
            failures.append(f"external property read names a non-type: {row[2]}")

    # ── 2. EVERY TIER IS IN THE VOCABULARY ───────────────────────────────────
    seen_tiers = set()
    for row in read_raw(os.path.join(raw, "call-class.csv")):
        if len(row) >= 3:
            seen_tiers.add(row[2])
    for row in read_raw(os.path.join(raw, "call-chain-edges.csv")):
        if len(row) >= 6:
            seen_tiers.add(row[5])
    for t in sorted(seen_tiers - TIERS):
        failures.append(f"tier not in the declared vocabulary: {t!r}")

    # ── 3. A CALL THROUGH `dynamic` IS ambiguous_dynamic ─────────────────────
    # Not `ambiguous_unknown`, which is where the engine's own blind spots are
    # counted -- the front end's notes call this "a declared blind spot, separately
    # counted; never fold it into ambiguous_unknown: it is known-undecidable, not a
    # failure". And not `boundary_lib`, which asserts a target.
    dyn_sites = dynamic_receiver_sites(ir_dir)
    if dyn_sites:
        tier = {row[1]: row[2] for row in read_raw(os.path.join(raw, "call-class.csv"))
                if len(row) >= 3}
        for e in sorted(dyn_sites):
            got = tier.get(e, "<no tier>")
            if got != "ambiguous_dynamic":
                failures.append(f"a call through `dynamic` is {got!r}, not 'ambiguous_dynamic'")

    # ── 4. NO SITE IS DROPPED ────────────────────────────────────────────────
    # Also gated by the score; repeated here so this file can be run on its own
    # output and still say whether the run is sound.
    dropped = len(read_raw(os.path.join(raw, "call-site-dropped.csv")))
    if dropped:
        failures.append(f"{dropped} call sites reached no output row")

    tag = f" [{label}]" if label else ""
    if failures:
        print(f"  engine invariants{tag}: {len(failures)} FAILED")
        for f in failures[:20]:
            print(f"      {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
