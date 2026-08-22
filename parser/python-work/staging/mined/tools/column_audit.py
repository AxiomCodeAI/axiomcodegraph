#!/usr/bin/env python3.10
"""Column-level audit: which columns are NEVER populated.

A silently-empty column passes every integrity check — referential integrity
skips empty FKs, arity is unaffected, and the golden file is stable — while
every query that needs it returns nothing. So the useful question is not "do
the files parse" but "which of the 451 frozen columns actually carry data".

Reports, per relation: row count, and every column that is empty in 100% of
rows, plus those empty in >90%.

Usage: column_audit.py <dir-of-csvs> [--all]
"""
import sys, os, collections

d = sys.argv[1]
show_all = "--all" in sys.argv
for fn in sorted(f for f in os.listdir(d) if f.endswith(".csv")):
    p = os.path.join(d, fn)
    text = open(p, encoding="utf-8").read()
    if not text.strip():
        print(f"\n{fn}: EMPTY FILE (no header, no rows)")
        continue
    lines = text.rstrip("\n").split("\n")
    header = lines[0].split("\t")
    rows = [l.split("\t") for l in lines[1:]]
    rows = [r for r in rows if len(r) == len(header)]
    n = len(rows)
    print(f"\n{fn}  rows={n}  cols={len(header)}")
    if n == 0:
        print("   (header only)")
        continue
    empties = []
    for i, h in enumerate(header):
        blank = sum(1 for r in rows if r[i] == "" or r[i] == "false" and False)
        blank = sum(1 for r in rows if r[i] == "")
        pct = 100.0 * blank / n
        # Report the COUNT, never a rounded percentage: 12,448 of 12,453 rounds
        # to "100.0% empty" and reads as unimplemented when the corpus simply
        # had five annotated parameters. Absolute zero is the only signal.
        if blank == n:
            empties.append((h, f"ALWAYS EMPTY (0 of {n} populated)"))
        elif pct > 90.0:
            empties.append((h, f"{n - blank} of {n} populated ({100 - pct:.2f}%)"))
        elif show_all:
            empties.append((h, f"{n - blank} of {n} populated"))
    for h, s in empties:
        print(f"   {h:<34} {s}")
    if not empties:
        print("   (every column populated somewhere)")
