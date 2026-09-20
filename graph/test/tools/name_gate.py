#!/usr/bin/env python3
"""Refuse a MEASURED SUBJECT's name in a tracked file.

WHY THIS EXISTS. The publishing guard is a PreToolUse hook: it reads the text of an
issue, a PR body or a commit message, and it never sees a file that is already committed.
A project name introduced in a source comment is therefore checked only if it also
happens to appear in the message of the commit that adds it, which is not where such
names get written. One reached main that way and was removed in #1144, found by reading
a diff rather than by any check. This is the check.

WHAT IS AND IS NOT A SUBJECT, because the distinction is the whole difficulty:

  a DEPENDENCY the engine builds on          may be named (Souffle, tree-sitter, SQLite)
  a FRAMEWORK a catalogue models             may be named, and naming it is the POINT of
                                             config-resolution/knobs.dl: that file exists
                                             to list which spellings the rules assume
  a project the engine was SCORED ON         may NOT be named, because publishing what a
                                             rule was tuned against is exactly what
                                             keeping the corpus outside the repo prevents

Only the third is denied, and the list of them lives OUTSIDE this repository for the same
reason the competitor list does: a list of names you are trying not to publish is itself
the thing you must not publish. When the list is absent the gate SKIPS and says so, the
way the suite skips the CPython oracle. A skip is not a pass and is printed as neither.

THE DEBT FILE. `name-debt.txt` beside this script lists PATHS, never names, of files that
carried such a name before the gate existed. It behaves like the suite's known-missing
files: a name in a file NOT listed fails, and a listed file that has become CLEAN also
fails, so the debt is forced down rather than left to rot.

usage: name_gate.py [<repo-root>]
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEBT = os.path.join(HERE, "name-debt.txt")
LIST_ENV = "AXIOM_CORPUS_NAMES"
LIST_DEFAULT = os.path.join(os.path.expanduser("~"), ".claude", "axiom-corpus-names.txt")

# Binary and generated shapes the scan cannot say anything useful about.
SKIP_SUFFIX = (".png", ".jpg", ".jpeg", ".ico", ".gif", ".pdf", ".sqlite", ".jar",
               ".zip", ".gz", ".woff", ".woff2", ".ttf")


def patterns(path):
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            out.append(re.compile(line, re.I))
    return out


def tracked(root):
    r = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("name gate: not a git tree at %s" % root)
    return [p for p in r.stdout.splitlines() if p]


def main():
    root = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.abspath(
        os.path.join(HERE, "..", "..", ".."))

    listing = os.environ.get(LIST_ENV) or LIST_DEFAULT
    if not os.path.exists(listing):
        print("skip: no subject list at %s -- cannot check tracked files for a measured "
              "subject's name" % listing)
        return 0

    pats = patterns(listing)
    if not pats:
        raise SystemExit("name gate: %s declares no pattern -- refusing to pass "
                         "vacuously" % listing)

    debt = set()
    if os.path.exists(DEBT):
        with open(DEBT, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    debt.add(line)

    offending = set()
    for rel in tracked(root):
        if rel.endswith(SKIP_SUFFIX):
            continue
        p = os.path.join(root, rel)
        if not os.path.isfile(p):
            continue
        try:
            with open(p, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        if any(rx.search(text) for rx in pats):
            offending.add(rel)

    new = sorted(offending - debt)
    fixed = sorted(debt - offending)
    missing = sorted(d for d in debt if not os.path.exists(os.path.join(root, d)))

    if not new and not fixed and not missing:
        print("name gate: ok (%d tracked files, %d carrying a subject name, all declared)"
              % (len(tracked(root)), len(offending)))
        return 0

    for rel in new:
        print("  FAIL  name gate: %s names a measured subject. Describe it by what it IS "
              "(\"a 1300-file CMS\"), never by whose project it is." % rel)
    for rel in fixed:
        print("  FAIL  name gate: %s is listed in name-debt.txt but is now clean. Remove "
              "the line: the debt list may only shrink." % rel)
    for rel in missing:
        print("  FAIL  name gate: name-debt.txt lists %s, which is not tracked. A stale "
              "entry hides a real one." % rel)
    print("name gate: FAILED (%d new, %d stale, %d missing)"
          % (len(new), len(fixed), len(missing)))
    return 1


if __name__ == "__main__":
    sys.exit(main())
