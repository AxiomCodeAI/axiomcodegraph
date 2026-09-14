"""Supplying a library must never REMOVE an answer, or make one less identifiable.

Solves the same client twice with the same engine — once with an empty library, once with
a real one — and asserts that staging only ever improves an answer.

This is not a coverage check. It is an INVARIANT: a library IR is strictly more
information, so it can only ever move a site from unresolved to resolved, or from a named
boundary to a concrete target. A site going the other way means a rule stopped firing
without its replacement arriving, which is exactly what happened when the external
fallback was gated on `import_unlinked` and staging a library made that false.

Nothing else in the suite can catch it: every other case fixes the library input, so a
regression only shows up when the two runs are compared against each other.

── WHY BUCKET MEMBERSHIP WAS NOT ENOUGH (#313) ─────────────────────────────
The invariant has two clauses and this checked only the first. `RESOLVED` collapses
`known_edge`, `multi_inferred` and `boundary_lib` into one set, and the comparison was
`resolved_sites(empty) - resolved_sites(real)` — so any movement WITHIN the set was
invisible, including movement in the direction the docstring forbids. Measured on three
library configurations, this printed `library monotonicity ok` while every boundary
target became less identifiable:

    external:Model.save      ->  lib:m.save            (the client's own parameter)
    external:Engine.connect  ->  lib:e.connect         (the client's own local)
    external:build_cache.get ->  lib:get               (qualifier dropped)
    external:make_engine     ->  PY_METHOD_<hash>      (a .pyi declaration, bodyIsStub)

All four stayed `boundary_lib`, so `lost` was empty and the run passed.

── WHAT IS COMPARED NOW, AND WHAT STILL CANNOT BE ──────────────────────────
Targets per site, ranked over the prefixes the two producers already emit. Measured
vocabulary across both runs of the torture set:

    1030  PY_METHOD_<hash>     313  builtin:X.y     238  builtin:y
      66  external:y            38  external:X.y      2  lib:X.y

so three levels are available without a new relation: a concrete method outranks a
qualified name, which outranks a bare one. Plus a target that acquires `bodyIsStub`
fails outright, because staging must not introduce a target with no body.

THIS RANK CANNOT CATCH ONE OF THE TWO REGRESSIONS #313 NAMES, and that is worth stating
rather than leaving to be discovered. `external:Model.save -> lib:m.save` is qualified on
both sides, so both rank the same; telling `Model` (a type) from `m` (a parameter) needs
the IR's type names, not a prefix. That one is an ENGINE defect — the engine should not
emit the receiver expression as a target — and is filed as such; a harness rank is
defence in depth and this level of it does not reach that shape.

The rank is also deliberately coarse. It fires on a DOWNGRADE, never on a lateral move,
because the target convention the two producers use is not written down anywhere and an
invariant cannot be tightened against an unstated convention.

usage: library_monotonicity.py <out-with-empty-lib> <out-with-real-lib> [ir-dir ...]
       ir-dirs are searched for bodyIsStub; omit them and that clause is skipped, loudly.
exit 0 if the invariant holds, 1 with the offending sites if it does not.
"""
import csv
import os
import sys

csv.field_size_limit(10 * 1024 * 1024)

RESOLVED = {"known_edge", "multi_inferred", "boundary_lib"}


def targets_by_site(out):
    """site -> set of target strings, for sites the run considers resolved."""
    per = {}
    with open(f"{out}/call-chain-edges.csv", encoding="utf-8") as fh:
        for line in fh:
            f = line.rstrip("\n").split("\t")
            if len(f) >= 6 and f[5] in RESOLVED:
                per.setdefault(f[0], set()).add(f[3])
    return per


def rank(target):
    """How identifiable an answer is. 3 a concrete method, 2 qualified, 1 a bare name.

    Coarse on purpose: see the module docstring on why a finer order cannot be asserted
    against a convention nobody has written down.
    """
    if target.startswith("PY_METHOD_"):
        return 3
    rest = target.split(":", 1)[1] if ":" in target else target
    return 2 if "." in rest else 1


def _kind(target):
    """The target's SHAPE, for grouping movements: the prefix plus whether it is
    qualified. Only used for reporting -- `rank` is what the invariant is asserted on."""
    if target.startswith("PY_METHOD_"):
        return "PY_METHOD_<hash>"
    pre, _, rest = target.partition(":")
    if not _:
        return "other"
    return f"{pre}:" + ("X.y" if "." in rest else "y")


def stub_methods(ir_dirs):
    """Every method target whose body is `...`, across the client and staged libraries."""
    stubs = set()
    for d in ir_dirs:
        p = os.path.join(d, "all-python-methods.csv")
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8", errors="replace") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                if (row.get("bodyIsStub") or "").strip().lower() == "true":
                    h = row.get("pyMethodUniqueHash")
                    if h:
                        stubs.add(h)
    return stubs


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__.strip().splitlines()[-3])
        return 2
    empty, real = sys.argv[1], sys.argv[2]
    ir_dirs = sys.argv[3:]
    a, b = targets_by_site(empty), targets_by_site(real)

    # CLAUSE 1, unchanged: an answer may not disappear.
    lost = set(a) - set(b)
    if lost:
        print(f"FAIL: {len(lost)} site(s) resolved WITHOUT a library became unresolved WITH one")
        for h in sorted(lost)[:20]:
            print(f"  {h}")
        return 1

    # CLAUSE 2: an answer may not become less identifiable, and may not acquire a body
    # that is `...`. Both are downgrades the bucket comparison could not see.
    stubs = stub_methods(ir_dirs)
    downgraded, stubbed, moved = [], [], []
    for h, ta in a.items():
        tb = b.get(h)
        if not tb:
            continue
        if ta != tb:
            moved.append((h, ta, tb))
        ra, rb = max(map(rank, ta)), max(map(rank, tb))
        if rb < ra:
            downgraded.append((h, ta, ra, tb, rb))
        elif stubs:
            new_stubs = {t for t in tb if t in stubs} - {t for t in ta if t in stubs}
            if new_stubs:
                stubbed.append((h, ta, sorted(new_stubs)))

    if downgraded or stubbed:
        if downgraded:
            print(f"FAIL: {len(downgraded)} site(s) got a LESS identifiable target with a library")
            for h, ta, ra, tb, rb in sorted(downgraded)[:20]:
                print(f"  {h}  rank {ra} -> {rb}")
                print(f"      without: {sorted(ta)}")
                print(f"      with   : {sorted(tb)}")
        if stubbed:
            print(f"FAIL: {len(stubbed)} site(s) acquired a target whose body is `...`")
            for h, ta, ns in sorted(stubbed)[:20]:
                print(f"  {h}")
                print(f"      without: {sorted(ta)}")
                print(f"      with   : {ns}  (bodyIsStub=true)")
        return 1

    # MOVEMENT IS REPORTED, so an intended upgrade is reviewable rather than merely
    # silent -- the old version printed only "ok" and a count, which is how four
    # regressions passed through it. Summarised BY TRANSITION rather than per site: the
    # torture set moves 88 sites on a healthy run and the harness runs this twice, so
    # 176 lines of expected upgrade is noise a reader learns to skip, which is the same
    # failure as saying nothing. AXIOM_MONOTONICITY_VERBOSE lists every site.
    print(f"library monotonicity ok ({len(a)} resolved without a library, {len(b)} with; "
          f"0 lost, 0 downgraded, {len(moved)} moved)")
    if moved:
        shape = {}
        for h, ta, tb in moved:
            key = (_kind(max(ta, key=rank)), _kind(max(tb, key=rank)))
            shape.setdefault(key, []).append((h, ta, tb))
        for (ka, kb), rows in sorted(shape.items(), key=lambda kv: -len(kv[1])):
            h, ta, tb = rows[0]
            print(f"  {len(rows):>4}  {ka} -> {kb}    e.g. {sorted(ta)} -> {sorted(tb)}")
        if os.environ.get("AXIOM_MONOTONICITY_VERBOSE"):
            for h, ta, tb in sorted(moved):
                print(f"      {h}  {sorted(ta)} -> {sorted(tb)}")
    if not ir_dirs:
        print("  note: no IR directory given, so the bodyIsStub clause was NOT checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
