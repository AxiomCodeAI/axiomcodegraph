#!/usr/bin/env python3
"""Compare a case's actual rows with its reviewed expectation.

  gate.py <expected.tsv> <actual.tsv> [<known-missing>]

expected.tsv: '#' header lines, one of which must read '# reviewed: yes ...' (an oracle dump nobody
has read is not an expectation), then rows. Rows compare as a MULTISET.
  missing  = expected - actual   -> FAIL unless the row is listed in known-missing
  extra    = actual - expected   -> FAIL (a guess, a duplicate, or a wrong attribute)
  a known-missing row that is now present -> FAIL (remove it from known-missing; the gap closed)
  fewer than 1 expected row compared      -> FAIL (a 0/0 is not a pass)
"""
import collections
import sys


def rows(path):
    out = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if line and not line.startswith('#'):
                out.append(line)
    return out


def main():
    exp_path, act_path = sys.argv[1], sys.argv[2]
    known_path = sys.argv[3] if len(sys.argv) > 3 else None
    header = [l for l in open(exp_path, encoding='utf-8') if l.startswith('#')]
    if not any(l.lower().startswith('# reviewed: yes') for l in header):
        print('  expected file is not marked "# reviewed: yes" — review the oracle dump first')
        return 1
    exp = collections.Counter(rows(exp_path))
    act = collections.Counter(rows(act_path))
    known = collections.Counter(rows(known_path)) if known_path else collections.Counter()
    if sum(exp.values()) < 1:
        print('  0 expected rows: a case must compare at least one row')
        return 1
    stray_known = known - exp
    missing = exp - act
    extra = act - exp
    new_missing = missing - known
    healed = known - missing - stray_known
    ok = True
    for title, c in (('MISSING', new_missing), ('EXTRA', extra), ('KNOWN GAP NOW PASSES (remove from known-missing)', healed),
                     ('KNOWN-MISSING ROW NOT IN EXPECTED', stray_known)):
        if c:
            ok = False
            print(f'  {title}: {sum(c.values())}')
            for r in sorted(c.elements())[:25]:
                print(f'    {r}')
    compared = sum(exp.values())
    print(f'  compared {compared} expected row(s); missing {sum(missing.values())} (known {sum((missing & known).values())}); extra {sum(extra.values())}')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
