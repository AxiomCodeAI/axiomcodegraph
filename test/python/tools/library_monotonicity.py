"""Supplying a library must never REMOVE an answer.

Solves the same client twice with the same engine — once with an empty library, once with
a real one — and asserts that no call site resolved in the first run is unresolved in the
second.

This is not a coverage check. It is an INVARIANT: a library IR is strictly more
information, so it can only ever move a site from unresolved to resolved, or from a named
boundary to a concrete target. A site going the other way means a rule stopped firing
without its replacement arriving, which is exactly what happened when the external
fallback was gated on `import_unlinked` and staging a library made that false.

Nothing else in the suite can catch it: every other case fixes the library input, so a
regression only shows up when the two runs are compared against each other.

usage: library_monotonicity.py <out-with-empty-lib> <out-with-real-lib>
exit 0 if the invariant holds, 1 with the offending sites if it does not.
"""
import sys

RESOLVED = {"known_edge", "multi_inferred", "boundary_lib"}


def resolved_sites(out):
    seen = set()
    with open(f"{out}/call-chain-edges.csv", encoding="utf-8") as fh:
        for line in fh:
            f = line.rstrip("\n").split("\t")
            if len(f) >= 6 and f[5] in RESOLVED:
                seen.add(f[0])
    return seen


def main() -> int:
    empty, real = sys.argv[1], sys.argv[2]
    a, b = resolved_sites(empty), resolved_sites(real)
    lost = a - b
    if lost:
        print(f"FAIL: {len(lost)} site(s) resolved WITHOUT a library became unresolved WITH one")
        for h in sorted(lost)[:20]:
            print(f"  {h}")
        return 1
    print(f"library monotonicity ok ({len(a)} resolved without a library, {len(b)} with; 0 lost)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
