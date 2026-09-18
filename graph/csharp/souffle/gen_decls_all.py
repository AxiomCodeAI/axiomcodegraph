#!/usr/bin/env python3
"""
Generate graph/csharp/souffle/decls_all.dl from the rules in engine/.

Soufflé needs a .decl for every derived relation, and hand-maintaining ~400 of them
next to the rules that define them is how a relation ends up declared at the wrong
arity: the program still compiles, the join silently matches nothing, and the only
symptom is a recall number that is lower than it should be. So the declarations are
DERIVED from the rules, and CI re-runs this with --check.

TWO THINGS ARE DERIVED, NOT GUESSED:

  ARITY, from the rule heads. A relation whose heads disagree about arity is an
  ERROR rather than a pick between them -- that disagreement is exactly the bug
  this file exists to prevent.

  WHICH COLUMNS ARE `number`. Soufflé will not type a variable that is the result
  of an aggregate or of arithmetic unless the column is declared number, and it
  reports that as "unable to deduce type for variable d" against the rule rather
  than against the declaration. Hand-listing the numeric columns means finding them
  one compile error at a time, so they are inferred from HOW EACH VARIABLE IS USED
  and then propagated to a fixpoint: a column is number if any rule binds it with an
  aggregate, with arithmetic or with to_number, or compares it against a numeric
  literal -- or if it is ever unified with a column already known to be number.

  Inference is deliberately narrow. `=` and `!=` between two variables say nothing
  (both are used constantly on hashes), and only a comparison against a literal
  number counts on its own. A column the evidence does not reach stays `symbol`,
  which is the safe default: souffle then reports a real error instead of this file
  inventing a type.

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

HEAD = re.compile(r"^([a-z_][a-z0-9_]*)\s*\(")
# A VARIABLE, which `_` is not. Soufflé's wildcard is anonymous: two `_` in two
# different atoms are unrelated. Letting it match here unified numeric evidence
# across every relation that ignores a column, and the symptom was 735 type errors
# on relations whose columns are plainly symbols.
IDENT = re.compile(r"^[a-z][a-z0-9_]*$|^_[a-z0-9_]+$")
NUMLIT = re.compile(r"^-?\d+$")

# Soufflé builtins, which are not relations and must not be mistaken for atoms.
BUILTINS = {
    "count", "min", "max", "sum", "to_number", "to_string", "strlen", "substr",
    "contains", "match", "ord", "cat", "range",
}

# TUNING INPUTS: staged as .facts by the executor rather than derived, so sweeping
# one costs no recompile (the binary cache key covers the program text, not the
# facts). Each is declared whether or not a rule reads it yet, because the executor
# emits one .input directive per staged file and an undeclared relation is a hard
# error. EMPTY IS THE SOUND DEFAULT for every one: no cap, nothing gated.
TUNING_INPUTS = {
    # --dispatch-cap K: refuse a virtual-dispatch fan wider than K. Recall-risky, so
    # opt-in; empty means uncapped, which is the answer that cannot be wrong.
    "dispatch_cap": ("symbol",),
    # --lib-depth: how far a client->lib chain is expanded. Empty means uncapped.
    "lib_max_depth": ("number",),
    # The shared executor ALWAYS stages these two, for every language, and emits one
    # .input directive per staged file. An undeclared one is a hard error at compile
    # time ("Undefined relation jdk_max_depth"), so they are declared here whether or
    # not a C# rule reads them.
    #
    # NEITHER IS READ BY A C# RULE, and that is deliberate rather than pending.
    # jdk_max_depth caps how deep a Java run walks into the JDK; the C# equivalent is
    # lib_max_depth, which the staging loop already uses. taint_gating switches on
    # Java's taint-gated library expansion, and there is no taint layer here.
    "jdk_max_depth": ("number",),
    "taint_gating": ("symbol",),
    # THE RUNTIME TRACE, staged by the harness as facts. (CallerKey, CalleeKey,
    # Count), keyed on `Type.Name/paramCount` -- the one spelling the instrumenter
    # can produce without a semantic model. EMPTY IS THE NORMAL CASE and means the
    # engine behaves exactly as it does with no trace, which is what makes the
    # feature safe to leave switched on.
    "runtime_observed_edge": ("symbol", "symbol", "symbol"),
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


def statements(src):
    """Split a comment-stripped rule file into statements, on '.' at depth 0."""
    out = []
    depth = 0
    cur = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c == '"':
            cur.append(c)
            i += 1
            while i < n:
                cur.append(src[i])
                if src[i] == '"' and src[i - 1] != "\\":
                    i += 1
                    break
                i += 1
            continue
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        if c == "." and depth == 0:
            out.append("".join(cur))
            cur = []
            i += 1
            continue
        cur.append(c)
        i += 1
    if "".join(cur).strip():
        out.append("".join(cur))
    return out


def body_atoms(body):
    """Yield (relation, [args]) for every atom in a rule body, including inside
    aggregate braces -- which is where count/min/max subgoals live, and where a
    numeric column is most often first bound."""
    for m in re.finditer(r"([a-z_][a-z0-9_]*)\s*\(", body):
        name = m.group(1)
        if name in BUILTINS:
            continue
        args, _ = split_args(body, m.end() - 1)
        if args is not None:
            yield name, [a.strip() for a in args]


def numeric_evidence(body):
    """Variables this rule body forces to be numbers, on narrow evidence only."""
    num = set()
    # X = count : {...}   /   X = sum : {...}
    for m in re.finditer(r"([a-z_][a-z0-9_]*)\s*=\s*(?:count|sum)\s*:", body):
        num.add(m.group(1))
    # X = min k : {...}   /   X = max k : {...}   -- both X and the bound variable
    for m in re.finditer(r"([a-z_][a-z0-9_]*)\s*=\s*(?:min|max)\s+([a-z_][a-z0-9_]*)\s*:", body):
        num.add(m.group(1))
        num.add(m.group(2))
    # X = to_number(...)
    for m in re.finditer(r"([a-z_][a-z0-9_]*)\s*=\s*to_number\s*\(", body):
        num.add(m.group(1))
    # arithmetic: X = a + 1, X = pc - opt, ...
    for m in re.finditer(r"([a-z_][a-z0-9_]*)\s*=\s*([^,;)]*?[-+*/][^,;)]*)", body):
        lhs, rhs = m.group(1), m.group(2)
        if '"' in rhs or "cat(" in rhs or "substr(" in rhs:
            continue
        num.add(lhs)
        for v in re.findall(r"[a-z_][a-z0-9_]*", rhs):
            if v not in BUILTINS and v != "_":
                num.add(v)
    # a comparison against a NUMERIC LITERAL. `x >= y` between two variables says
    # nothing on its own and is handled by the fixpoint.
    for m in re.finditer(r"([a-z_][a-z0-9_]*)\s*(?:>=|<=|>|<)\s*(-?\d+)\b", body):
        num.add(m.group(1))
    for m in re.finditer(r"(-?\d+)\s*(?:>=|<=|>|<)\s*([a-z_][a-z0-9_]*)\b", body):
        num.add(m.group(2))
    return num


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

    files = sorted(ENGINE.rglob("*.dl"))
    if not files:
        print(f"gen_decls_all: no .dl files under {ENGINE}", file=sys.stderr)
        return 2

    seen = {}     # relation -> {arity: [files]}
    rules = []    # (head, head_args, body, numeric_vars)

    for f in files:
        # export/ is documentation, not part of the compiled program (run-souffle.sh
        # skips it), so a relation mentioned only there must not be declared.
        if f.parent.name == "export":
            continue
        src = strip_comments(f.read_text())
        where = str(f.relative_to(ENGINE.parent))
        for stmt in statements(src):
            s = stmt.strip()
            if not s:
                continue
            m = HEAD.match(s)
            if not m:
                continue
            name = m.group(1)
            args, end = split_args(s, m.end() - 1)
            if args is None:
                continue
            head_args = [a.strip() for a in args]
            rest = s[end + 1:].lstrip()
            if rest.startswith(":-"):
                body = rest[2:]
            elif rest == "":
                body = ""
            else:
                continue
            if name not in skip:
                seen.setdefault(name, {}).setdefault(len(head_args), []).append(where)
            rules.append((name, head_args, body, numeric_evidence(body)))

    problems = []
    for name, arities in sorted(seen.items()):
        if len(arities) > 1:
            detail = "; ".join(
                f"arity {a} in {sorted(set(ws))}" for a, ws in sorted(arities.items())
            )
            problems.append(f"  {name}: {detail}")
    if problems:
        print("gen_decls_all: a relation is used at two arities -- fix the rules:", file=sys.stderr)
        print("\n".join(problems), file=sys.stderr)
        return 1

    # ── NUMBER-COLUMN FIXPOINT ───────────────────────────────────────────────
    # A column is number if a rule binds it numerically, or if it is unified with a
    # column already known to be number. Iterated until nothing changes, so evidence
    # found in one rule reaches every relation that shares the variable.
    numcols = {name: set() for name in seen}
    for name, types in TUNING_INPUTS.items():
        numcols.setdefault(name, set())
        numcols[name] = {i for i, t in enumerate(types) if t == "number"}

    changed = True
    rounds = 0
    while changed and rounds < 100:
        changed = False
        rounds += 1
        for head, hargs, body, numvars in rules:
            local = set(numvars)
            for rel, args in body_atoms(body):
                for i, a in enumerate(args):
                    if i in numcols.get(rel, ()) and IDENT.match(a):
                        local.add(a)
            # a variable compared with a known-numeric variable is numeric too
            for m in re.finditer(r"([a-z_][a-z0-9_]*)\s*(?:>=|<=|>|<)\s*([a-z_][a-z0-9_]*)", body):
                a, b = m.group(1), m.group(2)
                if not (IDENT.match(a) and IDENT.match(b)):
                    continue
                if a in local:
                    local.add(b)
                if b in local:
                    local.add(a)
            if head in numcols:
                for i, a in enumerate(hargs):
                    if a == "_":
                        continue
                    if (a in local or NUMLIT.match(a)) and i not in numcols[head]:
                        numcols[head].add(i)
                        changed = True
            for rel, args in body_atoms(body):
                if rel not in numcols:
                    continue
                for i, a in enumerate(args):
                    if a == "_":
                        continue
                    if a in local and i not in numcols[rel]:
                        numcols[rel].add(i)
                        changed = True

    if rounds >= 100:
        print("gen_decls_all: number-column inference did not settle", file=sys.stderr)
        return 1

    lines = [
        "// ============================================================================",
        "// Derived relation declarations for the C# engine.",
        "//",
        "// GENERATED FROM THE RULES IN graph/csharp/engine/ BY gen_decls_all.py.",
        "// DO NOT HAND-EDIT. Re-run `python3 gen_decls_all.py --check` in CI.",
        "//",
        "// Both the arity and which columns are `number` are derived from the rules. A",
        "// hand-maintained list is how a relation ends up declared at the wrong arity:",
        "// the program compiles, the join matches nothing, and the only symptom is a",
        "// recall number nobody can explain. A relation used at two arities is an error",
        "// from the generator rather than a silent choice between them.",
        "//",
        "// A column is `number` where a rule binds it with an aggregate, with arithmetic",
        "// or with to_number, or compares it against a numeric literal, or where it is",
        "// unified with a column already known to be number. Everything else is",
        "// `symbol`, which is the safe default: souffle then reports a real type error",
        "// rather than this file inventing a type.",
        "// ============================================================================",
        "",
    ]
    for name, types in sorted(TUNING_INPUTS.items()):
        cols = ",".join(f"c{i}:{t}" for i, t in enumerate(types))
        lines.append(f".decl {name}({cols})")
        seen.pop(name, None)
    lines.append("")

    n_num = 0
    for name, arities in sorted(seen.items()):
        arity = next(iter(arities))
        nums = numcols.get(name, set())
        n_num += len([i for i in nums if i < arity])
        cols = ",".join(
            f"c{i}:" + ("number" if i in nums else "symbol") for i in range(arity)
        )
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
    print(f"wrote decls_all.dl: {len(seen)} derived relations, {n_num} number columns inferred")
    return 0


if __name__ == "__main__":
    sys.exit(main())
