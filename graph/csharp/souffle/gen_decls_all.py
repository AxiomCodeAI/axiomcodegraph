#!/usr/bin/env python3
"""
Generate graph/csharp/souffle/decls_all.dl from the rule heads in engine/.

Soufflé needs a .decl for every derived relation, and hand-maintaining ~300 of them
next to the rules that define them is how a relation ends up declared at the wrong
arity: the program still compiles, the join silently matches nothing, and the only
symptom is a recall number that is lower than it should be. So the declarations are
DERIVED from the rules, and CI re-runs this with --check.

The arity is read from the head of every rule, and a relation whose heads disagree
about arity is an ERROR rather than a guess -- that disagreement is exactly the bug
this file exists to prevent, and picking one of the two would hide it.

Relations declared in decls_base.dl (the parser's own cs_* / lib_cs_* fact families)
are skipped: they are generated from the parser's schema and are the contract.

Usage:
  python3 gen_decls_all.py            # rewrite decls_all.dl
  python3 gen_decls_all.py --check    # exit 1 if it would change
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent / "engine"
BASE = HERE / "decls_base.dl"
OUT = HERE / "decls_all.dl"

# A rule head: an identifier, '(', then the argument list up to the matching ')'
# followed by ':-' (a rule) or '.' (a fact). Heads start a line in this codebase.
HEAD = re.compile(r"^([a-z_][a-z0-9_]*)\s*\(")

# TUNING INPUTS: staged as .facts by the executor rather than derived, so sweeping
# one costs no recompile (the binary cache key covers the program text, not the facts).
# Each is declared here whether or not a rule reads it yet, because the executor emits
# one .input directive per staged file and an undeclared relation is a hard error.
# EMPTY IS THE SOUND DEFAULT for every one of them: no cap, nothing gated.
TUNING_INPUTS = {
    # --dispatch-cap K: refuse a virtual-dispatch fan wider than K. Recall-risky, so
    # opt-in; empty means uncapped, which is the answer that cannot be wrong.
    "dispatch_cap": ("symbol",),
    # --lib-depth: how far a client->lib chain is expanded. Empty means uncapped.
    "lib_max_depth": ("number",),
}

# Relations that are INPUTS declared elsewhere, or number-typed specials declared by
# hand in the footer below.
NUMBER_TYPED = {
    # relation -> tuple of 'symbol' | 'number' per column
    "dispatch_capped_at": ("number",),
    "call_candidate_count": ("symbol", "number"),
    "call_dropped_by_cap": ("symbol", "number"),
    "call_chain_summary": ("symbol", "number"),
    "cha_override_count": ("symbol", "number"),
    "type_depth": ("symbol", "symbol", "number"),
    "member_lookup_depth": ("symbol", "symbol", "symbol", "number"),
    "dispatch_fan_width": ("symbol", "number"),
    "import_link_ambiguous": ("symbol", "symbol", "number"),
    "site_target_count": ("symbol", "number"),
    "protocol_edge_wide": ("symbol", "symbol", "number"),
    # Name resolution: a candidate carries its RANK and the answer is the best rank
    # per (module, name, arity). Ranks and counts are arithmetic, so they are number
    # columns; leaving them as symbols makes `min` and `>=` untypeable.
    "type_name_cand": ("symbol", "symbol", "symbol", "symbol", "symbol", "number"),
    "type_name_best_rank": ("symbol", "symbol", "symbol", "symbol", "number"),
    "type_name_count": ("symbol", "symbol", "symbol", "symbol", "number"),
    "type_base_count": ("symbol", "symbol", "number"),
    "type_base_chain": ("symbol", "symbol", "symbol", "number"),
    "member_cand": ("symbol", "symbol", "symbol", "symbol", "symbol", "number"),
    "member_best_rank": ("symbol", "symbol", "symbol", "number"),
    "scope_cand": ("symbol", "symbol", "symbol", "symbol", "number"),
    "scope_best_rank": ("symbol", "symbol", "number"),
    "local_bind_cand": ("symbol", "symbol", "symbol", "number"),
    "local_bind_best_depth": ("symbol", "symbol", "number"),
    "override_depth": ("symbol", "symbol", "symbol", "number"),
    "call_target_count": ("symbol", "symbol", "number"),
    "overload_cand": ("symbol", "symbol", "symbol", "number"),
    "overload_best_rank": ("symbol", "symbol", "number"),
    "method_arity_min": ("symbol", "symbol", "number"),
    "method_arity_max": ("symbol", "symbol", "number"),
}


def split_args(text, start):
    """Return (args, end_index) for the parenthesised list opening at text[start]=='('."""
    depth = 0
    i = start
    args = []
    cur = []
    while i < len(text):
        c = text[i]
        if c == '"':
            cur.append(c)
            i += 1
            while i < len(text):
                cur.append(text[i])
                if text[i] == '"' and text[i - 1] != "\\":
                    break
                i += 1
        elif c == "(":
            depth += 1
            if depth > 1:
                cur.append(c)
        elif c == ")":
            depth -= 1
            if depth == 0:
                args.append("".join(cur))
                return args, i
            cur.append(c)
        elif c == "," and depth == 1:
            args.append("".join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    return None, i


def strip_comments(src):
    """Remove // line comments and /* */ blocks, leaving string literals alone."""
    out = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c == '"':
            out.append(c)
            i += 1
            while i < n:
                out.append(src[i])
                if src[i] == '"' and src[i - 1] != "\\":
                    i += 1
                    break
                i += 1
            continue
        if src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
            continue
        if src.startswith("/*", i):
            i += 2
            while i < n and not src.startswith("*/", i):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def base_relations():
    names = set()
    for line in BASE.read_text().splitlines():
        m = re.match(r"\.decl\s+([a-z_][a-z0-9_]*)", line.strip())
        if m:
            names.add(m.group(1))
    return names


def main():
    skip = base_relations()
    if not skip:
        print("gen_decls_all: decls_base.dl declared nothing -- refusing to run", file=sys.stderr)
        return 2

    # relation -> {arity: [where it was seen]}
    seen = {}
    files = sorted(ENGINE.rglob("*.dl"))
    if not files:
        print(f"gen_decls_all: no .dl files under {ENGINE}", file=sys.stderr)
        return 2
    for f in files:
        # export/ is documentation, not part of the compiled program (run-souffle.sh
        # skips it), so a relation mentioned only there must not be declared.
        if f.parent.name == "export":
            continue
        src = strip_comments(f.read_text())
        for line in src.splitlines():
            m = HEAD.match(line)
            if not m:
                continue
            name = m.group(1)
            if name in skip:
                continue
            args, end = split_args(line, m.end() - 1)
            if args is None:
                # head spans lines; find the whole statement instead
                continue
            rest = line[end + 1:].lstrip()
            if not (rest.startswith(":-") or rest.startswith(".")):
                continue
            seen.setdefault(name, {}).setdefault(len(args), []).append(
                f"{f.relative_to(ENGINE.parent)}"
            )

    problems = []
    for name, arities in sorted(seen.items()):
        if len(arities) > 1:
            where = "; ".join(
                f"arity {a} in {sorted(set(ws))}" for a, ws in sorted(arities.items())
            )
            problems.append(f"  {name}: {where}")
    if problems:
        print("gen_decls_all: a relation is used at two arities -- fix the rules:", file=sys.stderr)
        print("\n".join(problems), file=sys.stderr)
        return 1

    lines = [
        "// ============================================================================",
        "// Derived relation declarations for the C# engine.",
        "//",
        "// GENERATED FROM THE RULE HEADS IN graph/csharp/engine/ BY gen_decls_all.py.",
        "// DO NOT HAND-EDIT. Re-run `python3 gen_decls_all.py --check` in CI.",
        "//",
        "// A hand-maintained declaration list is how a relation ends up declared at the",
        "// wrong arity: the program compiles, the join matches nothing, and the only",
        "// symptom is a recall number nobody can explain. Deriving them makes that",
        "// particular mistake unspellable, and a relation used at two arities is an",
        "// error here rather than a silent choice between them.",
        "// ============================================================================",
        "",
    ]
    # Tuning inputs first, so the block reads as "what the executor stages" before
    # "what the rules derive".
    for name, types in sorted(TUNING_INPUTS.items()):
        if name in seen:
            arity = next(iter(seen[name]))
            if arity != len(types):
                print(
                    f"gen_decls_all: tuning input {name} is pinned to {len(types)} columns "
                    f"but a rule derives it at arity {arity}",
                    file=sys.stderr,
                )
                return 1
            del seen[name]
        cols = ",".join(f"c{i}:{t}" for i, t in enumerate(types))
        lines.append(f".decl {name}({cols})")
    lines.append("")

    for name, arities in sorted(seen.items()):
        arity = next(iter(arities))
        types = NUMBER_TYPED.get(name, ("symbol",) * arity)
        if len(types) != arity:
            print(
                f"gen_decls_all: {name} is pinned to {len(types)} typed columns but used at arity {arity}",
                file=sys.stderr,
            )
            return 1
        cols = ",".join(f"c{i}:{t}" for i, t in enumerate(types))
        lines.append(f".decl {name}({cols})")
    text = "\n".join(lines) + "\n"

    if "--check" in sys.argv:
        current = OUT.read_text() if OUT.exists() else ""
        if current != text:
            print("gen_decls_all: decls_all.dl is out of date -- re-run without --check", file=sys.stderr)
            return 1
        print(f"{len(seen)} derived relations checked; decls_all.dl matches the rules")
        return 0

    OUT.write_text(text)
    print(f"wrote decls_all.dl: {len(seen)} derived relations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
