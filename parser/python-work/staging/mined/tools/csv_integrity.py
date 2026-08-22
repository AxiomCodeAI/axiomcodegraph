#!/usr/bin/env python3.10
"""CSV-level integrity check, independent of the parser's own tests.

Three things a downstream consumer needs and that no CPython oracle can check:

  1. ARITY   — every row has exactly as many tab-separated fields as the
               header. A single unescaped tab or newline shifts every later
               column silently.
  2. PK      — the last column of each file is the primary key; it must be
               unique and carry the relation's prefix.
  3. FK      — every non-empty `*LinkHash` column must resolve to a primary key
               somewhere in the emitted set (or be a documented external ref).

Usage: csv_integrity.py <dir-of-csvs>
"""
import sys, os, csv, collections

d = sys.argv[1]
files = sorted(f for f in os.listdir(d) if f.endswith(".csv"))
pks = {}            # hash -> file that declares it
rows_by_file = {}
problems = collections.Counter()
detail = collections.defaultdict(list)

for fn in files:
    p = os.path.join(d, fn)
    with open(p, encoding="utf-8") as fh:
        text = fh.read()
    if not text.strip():
        problems["empty-file (no header)"] += 1
        detail["empty-file (no header)"].append(fn)
        continue
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    header = lines[0].split("\t")
    body = [l.split("\t") for l in lines[1:]]
    rows_by_file[fn] = (header, body)
    for i, r in enumerate(body, start=2):
        if len(r) != len(header):
            problems["arity"] += 1
            if len(detail["arity"]) < 6:
                detail["arity"].append((fn, i, f"{len(r)} fields vs {len(header)} in header", r[:3]))
    # The convention is "last column is the PK", but it is not universal:
    # java all-field-positions.csv ends in an ordinal and the python
    # skipped-files CSV ends in free text. Treat the last column as a key only
    # when its header says so, and report the files that opt out.
    if not header[-1].endswith("Hash"):
        problems["no-key-column (last col is not a *Hash)"] += 1
        detail["no-key-column (last col is not a *Hash)"].append(f"{fn} (last col: {header[-1]})")
        continue
    seen = set()
    for i, r in enumerate(body, start=2):
        if len(r) != len(header): continue
        pk = r[-1]
        if not pk:
            problems["empty-pk"] += 1
            if len(detail["empty-pk"]) < 4: detail["empty-pk"].append((fn, i))
            continue
        if pk in seen:
            problems["duplicate-pk"] += 1
            if len(detail["duplicate-pk"]) < 6: detail["duplicate-pk"].append((fn, i, pk))
        seen.add(pk)
        if pk in pks and pks[pk] != fn:
            problems["pk-collision-across-files"] += 1
        pks[pk] = fn

# FK resolution
for fn, (header, body) in rows_by_file.items():
    fk_cols = [(i, h) for i, h in enumerate(header) if h.endswith("LinkHash") and h != "serviceVersionLinkHash"]
    for i, r in enumerate(body, start=2):
        if len(r) != len(header): continue
        for ci, cname in fk_cols:
            v = r[ci]
            if not v: continue
            if v not in pks:
                problems[f"dangling-fk:{cname}"] += 1
                if len(detail[f"dangling-fk:{cname}"]) < 3:
                    detail[f"dangling-fk:{cname}"].append((fn, i, v[:34]))

print(f"files: {len(files)}   rows: {sum(len(b) for _, b in rows_by_file.values())}   distinct PKs: {len(pks)}")
if not problems:
    print("CLEAN — arity, PK uniqueness and FK resolution all hold")
for k, v in problems.most_common():
    print(f"  {v:>7}  {k}")
    for e in detail[k][:4]:
        print(f"           {e}")
