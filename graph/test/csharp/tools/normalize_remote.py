#!/usr/bin/env python3
"""The C# remote-edge golden: one line per cross-process fact, both ends named.

remote-edge.csv, remote-unserved.csv and remote-unsent.csv hold CS_METHOD hashes, which
are not stable across checkouts, so the ends are resolved to the method's qualified name
and parameter count from the IR. Same shape as graph/test/java/tools/normalize_remote.py,
with the unjoined halves and the undetermined sends added: a golden that lists only the edges passes when a send
silently stops being reported.

usage: normalize_remote.py <IR-dir> <engine-out-dir>
"""
import csv
import os
import sys


def rows(path):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8') as fh:
        return [r for r in csv.reader(fh, delimiter='\t') if r]


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: normalize_remote.py <ir> <out>")
    ir, out = sys.argv[1], sys.argv[2]
    if os.path.isdir(os.path.join(ir, 'csharp')):
        ir = os.path.join(ir, 'csharp')
    label = {}
    with open(os.path.join(ir, 'all-csharp-methods.csv'), newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh, delimiter='\t'):
            label[r['csMethodUniqueHash']] = f"{r['qualifiedName']}/{r['parameterCount']}"
    L = lambda h: label.get(h, h)
    lines = [f"edge\t{r[2]}\t{r[4]}\t{r[3]}\t{L(r[0])} -> {L(r[1])}" for r in rows(os.path.join(out, 'remote-edge.csv'))]
    lines += [f"unserved\t{r[1]}\t-\t{r[2]}\t{L(r[0])}" for r in rows(os.path.join(out, 'remote-unserved.csv'))]
    lines += [f"unsent\t{r[1]}\t-\t{r[2]}\t{L(r[0])}" for r in rows(os.path.join(out, 'remote-unsent.csv'))]
    lines += [f"undetermined\t{r[1]}\t-\t{r[2]}\t{L(r[0])}" for r in rows(os.path.join(out, 'remote-undetermined.csv'))]
    print('\n'.join(sorted(set(lines))))


if __name__ == '__main__':
    main()
