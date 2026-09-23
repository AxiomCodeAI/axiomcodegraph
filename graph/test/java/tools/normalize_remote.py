#!/usr/bin/env python3
"""The remote-edge golden: one line per cross-process edge, both ends named.

remote-edge.csv holds METHOD_REGISTRY hashes, and those are not stable across checkouts,
so a golden of the raw rows passes only in the working tree it was blessed in. The ends are
resolved to `pkg.Type#method(params)` the way config_report.py names them.

usage: normalize_remote.py <IR-dir> <OUT-dir> [lib-ir]
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config_report import Labels, add_library_labels, load


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) not in (2, 3):
        sys.exit("usage: normalize_remote.py <ir> <out> [lib-ir]")
    L = Labels(args[0])
    if len(args) == 3:
        add_library_labels(L, args[2])
    # remote-edge.csv: from, to, kind, key, confidence
    lines = sorted(f"{r[2]}\t{r[4]}\t{r[3]}\t{L.lbl(r[0])} -> {L.lbl(r[1])}"
                   for r in load(args[1], 'remote-edge.csv'))
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
