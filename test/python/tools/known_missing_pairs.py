#!/usr/bin/env python3
"""Emit the engine-pairs file a PERFECT engine would produce for a case: every expected edge
except the ones recorded as accepted gaps.

Exists so tools/known-missing-test.sh can assert oracle_check.py's reconciliation without
building an IR and running the solver. What that test pins is the reconciliation — an unlisted
miss fails, a listed edge that resolves fails, a stale entry fails — and none of that depends on
the engine's actual output. Synthesising the input keeps the test self-contained and fast, so it
runs on every suite invocation instead of skipping whenever no work dir happens to be lying
around. A check that usually skips is the defect this whole area keeps producing (#196, #224,
#254). See issue #264.

usage: known_missing_pairs.py <case-src> <known-missing-file>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle_path import harness_root                        # noqa: E402

harness_root()
from callchain_oracle import build                          # noqa: E402
from callchain_oracle.build import expected_edges           # noqa: E402
from oracle_check import read_known_missing                 # noqa: E402


def main() -> int:
    src, known_path = sys.argv[1], sys.argv[2]
    entry = os.path.join(src, 'main.py')
    oracle = build(src, entry=entry if os.path.exists(entry) else None)
    expected = {(e['caller'], e['callee']) for e in expected_edges(oracle)}
    gaps = read_known_missing(known_path)
    for caller, callee in sorted(expected - gaps):
        print(f'{caller}\t{callee}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
