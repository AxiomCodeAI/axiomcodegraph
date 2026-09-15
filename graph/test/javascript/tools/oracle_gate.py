#!/usr/bin/env python3
"""
Gate a run on the compiler's per-site verdicts.

Reads the adjudication written by oracle_diff.py (one line per compiler-decided site)
and a known-defect list, and fails when either side moved:

  * a MISSED / WRONG / LIB_WRONG / ENGINE_DROPPED line that the known list does not
    name is a NEW defect;
  * a known entry that no longer appears as a defect is STALE (the gap closed, or the
    site moved) and must be removed, so the list cannot rot.

The known list is one site per line (`file:line:col`, the rest of the line ignored),
`#` comments and blank lines allowed. A missing list is an empty list.

Shared by run-tests.sh (per case), torture/run.sh and realapp/run.sh, so every program
scored against the compiler is gated the same way; before this, only the regression
cases were, and the torture project carried a WRONG site the harness printed and passed.

Usage: oracle_gate.py <actual.oracle> <known-file>
Exit 0 when the verdicts match the list; 1 with the lines printed otherwise.
"""
import os
import re
import sys

DEFECT = re.compile(r'  (MISSED|WRONG|LIB_WRONG|ENGINE_DROPPED)  ')


def main():
    actual, known_path = sys.argv[1], sys.argv[2]
    defects = set()
    for line in open(actual):
        if DEFECT.search(line):
            defects.add(line.split(' ', 1)[0])
    known = set()
    if os.path.exists(known_path):
        for line in open(known_path):
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            known.add(line.split(' ', 1)[0])
    new = sorted(defects - known)
    stale = sorted(known - defects)
    if new:
        print('FAIL (oracle: the compiler decided these and the engine did not agree)')
        for s in new:
            print('    ' + s)
        return 1
    if stale:
        print('FAIL (oracle: known entries now resolve; remove them from %s)' % os.path.basename(known_path))
        for s in stale:
            print('    ' + s)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
