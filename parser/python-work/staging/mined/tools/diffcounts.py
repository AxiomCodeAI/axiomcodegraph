#!/usr/bin/env python3.10
"""Join tree-sitter node counts (mine.ts) with CPython ast counts (ast_counts.py)
and report every file where a construct count disagrees.

A count disagreement is a *candidate* divergence: the two sides are counting the
same source construct, so a difference means one of them is not seeing what the
other sees.  Each key is validated on a known-good probe set before it is
trusted at corpus scale.
"""
import json, sys, collections

# ast key -> the tree-sitter node types that spell the same construct
MAP = {
    "call": ["call"],
    "function_definition": ["function_definition"],
    "class_definition": ["class_definition"],
    "lambda": ["lambda"],
    "attribute": ["attribute"],
    "subscript": ["subscript"],
    "await": ["await"],
    "yield": ["yield"],
    "list_comprehension": ["list_comprehension"],
    "set_comprehension": ["set_comprehension"],
    "dictionary_comprehension": ["dictionary_comprehension"],
    "generator_expression": ["generator_expression"],
    "named_expression": ["named_expression"],
    "match_statement": ["match_statement"],
    "case_clause": ["case_clause"],
    "global_statement": ["global_statement"],
    "nonlocal_statement": ["nonlocal_statement"],
    "assert_statement": ["assert_statement"],
    "delete_statement": ["delete_statement"],
    "raise_statement": ["raise_statement"],
    "return_statement": ["return_statement"],
    "conditional_expression": ["conditional_expression"],
    "keyword_argument": ["keyword_argument"],
    "decorator": ["decorator"],
    "dictionary_splat": ["dictionary_splat"],
    "binary_operator": ["binary_operator"],
    "boolean_operator": ["boolean_operator"],
    "comparison_operator": ["comparison_operator"],
    "not_operator": ["not_operator"],
    "unary_operator": ["unary_operator"],
    "if_or_elif": ["if_statement", "elif_clause"],
    "for_statement": ["for_statement"],
    "while_statement": ["while_statement"],
    "with_statement": ["with_statement"],
    "with_item": ["with_item"],
    "try_statement": ["try_statement"],
    "finally_clause": ["finally_clause"],
    "except_clause": ["except_clause"],
    "pass_statement": ["pass_statement"],
    "break_statement": ["break_statement"],
    "continue_statement": ["continue_statement"],
    "dictionary": ["dictionary"],
    "list": ["list"],
    "list_pattern": ["list_pattern"],
    "set": ["set"],
    "slice": ["slice"],
    "import_statement": ["import_statement"],
    "import_from_statement": ["import_from_statement"],
    "future_import_statement": ["future_import_statement"],
    "pair": ["pair"],
    "true": ["true"],
    "false": ["false"],
    "none": ["none"],
    "ellipsis": ["ellipsis"],
    "float": ["float"],
    "integer": ["integer"],
}

def main():
    ts_path, ast_path = sys.argv[1], sys.argv[2]
    show = int(sys.argv[3]) if len(sys.argv) > 3 else 15
    only = sys.argv[4] if len(sys.argv) > 4 else None
    ts = {}
    for l in open(ts_path):
        r = json.loads(l); ts[r["file"]] = r
    rows = []
    skipped = collections.Counter()
    per_key = collections.Counter(); files_with = set()
    for l in open(ast_path):
        a = json.loads(l); f = a["file"]
        if "syntaxError" in a: skipped["cpython-syntax-error"] += 1; continue
        if "readError" in a: skipped["read-error"] += 1; continue
        t = ts.get(f)
        if t is None: skipped["no-ts-record"] += 1; continue
        if t.get("threw"): skipped["ts-threw"] += 1; continue
        if t.get("hasError"): skipped["ts-hasError"] += 1; continue
        tc, ac = t.get("types") or {}, a["ast"]
        for k, tstypes in MAP.items():
            if only and k != only: continue
            x = sum(tc.get(tt, 0) for tt in tstypes)
            y = ac.get(k, 0)
            if x != y:
                rows.append((f, k, x, y))
                per_key[k] += 1; files_with.add(f)
    print(f"compared={len(ts)-sum(skipped.values())} skipped={dict(skipped)}")
    print(f"files with >=1 count disagreement: {len(files_with)}")
    print("by construct (ts, cpython):", per_key.most_common())
    for r in rows[:show]: print("  ", r)

main()
