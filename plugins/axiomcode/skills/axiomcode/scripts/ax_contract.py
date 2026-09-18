#!/usr/bin/env python3
"""The contract every verb answers under. One module so the rules hold everywhere, not per script.

Written after a measured run where an agent asked the graph twice, was handed 492 methods across 67 files
ordered by how many methods each file contained, read three of them and patched one — while the files it
needed sat at ranks 67 and 78, and one was never listed at all. Nothing was missing from the answer. It
was unscoped, unranked, unbounded, and silent about what it could not see.

Five rules, and every verb obeys all five:

  1. SCOPE IS REQUIRED and validated against the graph. A name means different things in different
     packages; answering the wrong twin confidently is worse than refusing. Measured on one task, a scope
     took the right files from 2-of-5 in the top ten to 4-of-5 in the top six.
  2. A REFUSAL ALWAYS CARRIES A CORRECTION. Never a dead end: hand back the paths that exist, ranked by
     how well each matches what was asked. A dead end is what sends an agent back to grep for good.
  3. THE ANSWER IS BUDGETED here, not by the reader. Left unbounded, the caller truncates at an arbitrary
     point and may cut exactly the row that mattered.
  4. RANK BY RELEVANCE, NEVER BY SIZE. Ordering by how many methods a file holds puts the biggest file
     first, which is a property of the file and not of the question.
  5. STATE THE BOUND. Say what the answer cannot see — the relations this graph does not encode — so a
     partial list is not read as a complete one.
"""
import collections, re, sys

SPLIT = re.compile(r'[^A-Za-z0-9]+')
CAMEL = re.compile(r'[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+')
TESTY = re.compile(r'(^|[/_.-])(test|tests|spec|specs|__tests__|benchmark|benchmarks|bench|fixture|fixtures|mock|mocks|e2e)([/_.-]|$)', re.I)


def subtokens(s):
    """`onUnmountedHook` -> on unmounted hook; `api_create_app` -> api create app; a path -> its segments."""
    out = []
    for part in SPLIT.split(s or ''):
        for m in CAMEL.findall(part):
            if len(m) > 1: out.append(m.lower())
    return out


def dirs_with_counts(g, depth=3):
    """{path prefix: symbols under it} for every directory the graph indexes — the menu a refusal offers."""
    out = collections.Counter()
    for sid in g.sym:
        f = g.sym[sid].get('file') or ''
        parts = [x for x in f.split('/') if x and not x.startswith('<')]
        for d in range(1, min(len(parts), depth)):
            out['/'.join(parts[:d])] += 1
    return out


def offer(header, ranked, terms=(), hint=None):
    """Rule 2. Print a refusal that can be acted on, and return the exit code."""
    tset = set(terms)
    print(header + "\n")
    print("  re-run with one of these — best match first:\n")
    for path, n in ranked[:8]:
        mark = '   <- matches what you asked' if tset & set(subtokens(path)) else ''
        print(f"    --in {path:44.44} {n:6} symbol(s){mark}")
    print("\n  " + (hint or "a stack frame, the file you just read, or the package named in the issue is enough."))
    return 2


def require_scope(g, scope, terms=()):
    """Rule 1. Returns None when the scope is usable, or an exit code after printing the correction.

    Three ways a scope fails, and each gets its own answer rather than one generic error: absent, spelled
    for a path the graph does not have, or real but holding nothing that matches the question.
    """
    dirs = dirs_with_counts(g)
    def by_terms(item):
        return -(len(set(terms) & set(subtokens(item[0]))) * 100000 + item[1])
    if not scope:
        return offer("this needs to know WHERE to look: --in <path> is required.",
                     sorted(dirs.items(), key=by_terms), terms)
    if not g.q("SELECT COUNT(*) n FROM symbols WHERE file LIKE ?", f'%{scope}%')[0]['n']:
        want = set(subtokens(scope))
        near = sorted(dirs.items(), key=lambda d: -(len(want & set(subtokens(d[0]))) * 100000 + d[1]))
        return offer(f"no indexed file has '{scope}' in its path.", near, terms,
                     hint="check the spelling against these, or widen to the package above it.")
    return None


def budgeted(rows, budget, what="row"):
    """Rule 3. Returns (shown, footer) — the footer says what was withheld and how to see it."""
    shown = rows[:budget]
    rest = len(rows) - len(shown)
    foot = f"    … +{rest} more {what}(s) (--budget N)" if rest > 0 else ""
    return shown, foot


BOUND = ("bound: this follows call edges and names. Anything related through what the graph does not encode "
         "— a constant, a config key, a string, a framework convention, reflection — will not appear here "
         "however relevant it is.")
