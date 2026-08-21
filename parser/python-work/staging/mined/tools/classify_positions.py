#!/usr/bin/env python3.10
"""Classify every position mismatch so the residual is actionable.

Three classes are known and are NOT parser bugs:

  cpython-artifact:fstring-positions
      Before 3.12 CPython synthesises the positions of expressions inside an
      f-string -- every node in one interpolation reports the same col_offset.
      tree-sitter reports the real columns, so these can never agree and the
      oracle cannot adjudicate them.  ast_positions.py marks them.

  coordinate-system:utf16-vs-utf8-columns
      tree-sitter counts UTF-16 code units, CPython counts UTF-8 bytes, so any
      line containing non-ASCII disagrees on columns while agreeing on rows.

  known:<findingId>
      Already filed; matched by a source-line signature.

Anything left is UNEXPLAINED and is a candidate new finding.

Usage: classify_positions.py <ts-pos.jsonl> <ast-pos.jsonl> [showN]
"""
import json, sys, collections, re

KNOWN = [
    (re.compile(r"^\s*type\s*\("), "known:a4-001 type(x).attr misparse"),
    (re.compile(r"^\s*case\s+\w+(\.\w+)+"), "known:a4-009 dotted value pattern"),
    (re.compile(r"\*"), "known:a4-018 inverted splat (line contains a star)"),
    # ast has no node for the `@` itself, so the decorator position is derived
    # as (expression col - 1).  That derivation is wrong for `@(expr)`, where
    # the expression starts inside the parens.  A mapping artifact, not a bug.
    (re.compile(r"^\s*@\s*\("), "mapping-artifact:parenthesized-decorator"),
]

def main():
    ts = {}
    for l in open(sys.argv[1]):
        r = json.loads(l); ts[r["file"]] = r["pos"]
    show = int(sys.argv[3]) if len(sys.argv) > 3 else 25
    cls = collections.Counter(); detail = collections.defaultdict(list); n = 0
    for l in open(sys.argv[2]):
        a = json.loads(l)
        if "error" in a: continue
        t = ts.get(a["file"])
        if t is None: continue
        n += 1
        try:
            src = open(a["file"], encoding="utf-8", errors="surrogateescape").read().splitlines()
        except Exception:
            continue
        for k, plist in a["pos"].items():
            # the annotation shape divergence (a4-008) owns `subscript` wholesale
            if k == "subscript": continue
            mine = collections.Counter(tuple(x) for x in t.get(k, []))
            theirs = collections.Counter(tuple(x) for x in plist)
            if mine == theirs: continue
            if a.get("fstringPos", {}).get(k):
                cls["cpython-artifact:fstring-positions"] += 1; continue
            if a.get("patternPos", {}).get(k):
                cls["known:a4-009 dotted value pattern"] += 1; continue
            for (row, col) in sorted(set((mine - theirs).elements()) | set((theirs - mine).elements())):
                line = src[row] if row < len(src) else ""
                if not line.isascii():
                    c = "coordinate-system:utf16-vs-utf8-columns"
                else:
                    c = "UNEXPLAINED"
                    for rx, label in KNOWN:
                        if rx.search(line): c = label; break
                cls[c] += 1
                if len(detail[c]) < show:
                    detail[c].append((a["file"], row + 1, k, line.strip()[:70]))
    print(f"compared={n}")
    for c, v in cls.most_common(): print(f"  {v:>6}  {c}")
    for d in detail.get("UNEXPLAINED", []): print("   UNEXPLAINED", d)

main()
