"""Refuse a string literal in a rule body that is not a declared language or schema fact.

WHY THIS EXISTS. The engine is developed against a handful of codebases, a small sample of
the Python that exists. A rule keyed on a literal drawn from one of them would score well
on every measurement in this repo and generalise to nothing. Nothing else would catch it:
in a rule body, a literal encoding a language fact and a literal copied out of one project
look identical.

WHAT IS ALLOWED, and why each category is safe:

  IR enum values            e.g. "ATTRIBUTE_ACCESS", "METHOD_PARAM" -- these come from the
                            parser's schema. Recognised by shape (SCREAMING_SNAKE).
  provenance                "client" / "lib" -- assigned by which fact file a row is staged
                            into, not by anything in the source.
  confidence tiers          "known_edge", "multi_inferred", "boundary_lib",
                            "ambiguous_unknown" -- the engine's own output vocabulary.
  diagnostic labels         "no_rule", "escape_hatch", ... These are OUTPUT arguments of
                            call_unresolvable / site_reason / expr_type_untypable and are
                            never matched against input, so they cannot bias resolution.
  catalogue members         Anything declared as a one-argument fact in resolution/builtins.dl
                            (py_builtin_callable, builtin_method_returns, dict_lookup_method,
                            builtin_container_alias, ...). These ARE language facts, they are
                            reviewable as a list in one file, and builtin_method_returns is
                            generated from CPython by introspection rather than written out.
  structural scaffolding    "", "-", ".", the CSV booleans, label prefixes ("lib:",
                            "builtin:", "external:"), and small numerals.

Anything else fails. The fix is to move it into a catalogue with a justification, or to
remove it -- not to extend this allowlist casually.

WHAT THIS DOES NOT COVER. A rule whose SHAPE is fitted to one codebase without naming
anything is the subtler form of the same risk, and no literal check can see it. The
mitigations there are the A/B across every measured codebase, and rejecting a change that
gains on a fixture but nothing on real code.
"""
import os
import re
import sys

# repo root is FOUR levels up: tools -> python -> test -> <repo>. Getting this wrong
# makes os.walk find nothing and the gate pass vacuously, which is exactly what happened
# on the first attempt and is why this tool is checked against an injected literal.
_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))
ENGINE = os.path.join(_REPO, "graph", "python", "engine")
if not os.path.isdir(ENGINE):
    raise SystemExit(f"literal gate: engine dir not found at {ENGINE} -- refusing to pass vacuously")

PROVENANCE = {"client", "lib", "external", "builtin"}
TIERS = {"known_edge", "multi_inferred", "boundary_lib", "ambiguous_unknown"}
SCAFFOLD = {"", "-", ".", "true", "false", "lib:", "builtin:", "external:",
            "untyped_receiver:", "builtin:object.__init__", "_total_sites"}
ENUMISH = re.compile(r"^[A-Z][A-Z0-9_]*$")
NUMERIC = re.compile(r"^\d+$")
DUNDER = re.compile(r"^__\w+__$")
# a label only ever produced, never joined on
REASON_HEADS = ("call_unresolvable(", "site_reason(", "expr_type_untypable(",
                "call_chain_summary(")


GROUND_FACT = re.compile(r'^[a-z_]+\((?:\s*"[^"]*"\s*,?)+\)\.\s*$')


def catalogue_members(root):
    """Every value appearing in a GROUND FACT anywhere in the engine.

    A ground fact -- `relation("a", "b").` with no `:-` -- IS a declaration: it states a
    fact about the language rather than matching against a project. Those are reviewable as
    lists and are exactly what a catalogue is. Scanning by SHAPE rather than by filename
    matters because the catalogues are not all in one file: builtin_container_alias lives in
    resolution/builtin-types.dl, py_builtin_callable in resolution/builtins.dl, and a
    filename-scoped scan silently misses whichever it was not told about -- which is how the
    first version of this gate flagged fourteen legitimate typing aliases.
    """
    members = set()
    for dirpath, _, names in os.walk(root):
        for name in sorted(names):
            if not name.endswith(".dl"):
                continue
            for line in open(os.path.join(dirpath, name), encoding="utf-8"):
                s = line.strip()
                if s.startswith("//") or ":-" in s:
                    continue
                if GROUND_FACT.match(s):
                    members.update(re.findall(r'"([^"]*)"', s))
    return members


def main() -> int:
    allowed = catalogue_members(ENGINE)
    offenders = []
    for dirpath, _, names in os.walk(ENGINE):
        for name in sorted(names):
            if not name.endswith(".dl"):
                continue
            path = os.path.join(dirpath, name)
            for lineno, line in enumerate(open(path, encoding="utf-8"), 1):
                if line.strip().startswith("//"):
                    continue
                code = line.split("//")[0]
                is_reason_line = any(h in code for h in REASON_HEADS)
                for value in re.findall(r'"([^"]*)"', code):
                    if (value in PROVENANCE or value in TIERS or value in SCAFFOLD
                            or value in allowed or ENUMISH.match(value)
                            or NUMERIC.match(value) or DUNDER.match(value)
                            or is_reason_line):
                        continue
                    offenders.append((os.path.relpath(path, ENGINE), lineno, value))
    if offenders:
        print(f"FAIL: {len(offenders)} string literal(s) in a rule body are not a declared "
              f"schema or language fact.")
        print("Move each into a catalogue in resolution/builtins.dl with a justification, "
              "or remove it.")
        for rel, lineno, value in offenders:
            print(f"  {rel}:{lineno}  {value!r}")
        return 1
    print("literal gate ok (no undeclared string literal in any rule body)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
