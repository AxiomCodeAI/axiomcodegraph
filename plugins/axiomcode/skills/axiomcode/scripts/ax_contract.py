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
     first, which is a property of the file and not of the question. The same rule binds the CORRECTION a
     refusal offers: ranking candidate directories by symbol count put a monorepo's umbrella directory
     above every package inside it, and matching the task's words against a directory's own name promoted
     the package the repository is named after on the strength of the issue's version field.
  5. STATE THE BOUND. Say what the answer cannot see — the relations this graph does not encode — so a
     partial list is not read as a complete one.
"""
import collections, re, sys

SPLIT = re.compile(r'[^A-Za-z0-9]+')
CAMEL = re.compile(r'[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+')
TESTY = re.compile(r'(^|[/_.-])(test|tests|spec|specs|__tests__|benchmark|benchmarks|bench|fixture|fixtures|mock|mocks|e2e)([/_.-]|$)', re.I)


DELIM = re.compile(r'<\s*(issue|task|ticket|bug|problem|request)\s*>(.*?)<\s*/\s*\1\s*>', re.S | re.I)


def task_text(prompt):
    """The part of a prompt that describes the PROBLEM, not the part instructing the agent.

    A prompt handed to an agent is a wrapper plus a payload: rules about committing, running tests and
    staying in the directory, and then the issue. The wrapper is prose about software in general, so every
    word in it is a plausible code word — `repository`, `source`, `directory`, `commit`, `dependencies`,
    `change`, `tests` — and there is more of it than there is issue. Measured over 18 tasks on three
    languages, 705 characters of such a preamble moved the right package out of rank 1 on a third of them.

    A stoplist cannot separate them, because whether `commit` is noise depends on the repository. What can
    is the wrapper's own markup: a harness that wraps a payload says where the payload starts. Believe the
    marking when there is one, and otherwise use everything, which is the old behaviour.

    Only an explicit wrapper tag counts. Treating a ``` fence as a payload marker scored five points better
    on this sample and is wrong anyway: a fence inside an issue delimits an EXAMPLE, and keeping only the
    fences throws away the sentences that say what the example is meant to show.
    """
    text = prompt or ''
    blocks = [m.group(2) for m in DELIM.finditer(text)]
    return '\n'.join(blocks) if blocks else text


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


def drop_ancestors(ranked):
    """Never offer a directory when one of its own descendants is also on the menu.

    A parent holds the union of its children's symbols, so under any additive score it ranks at least as
    high as its best child and lands at rank 1 — the umbrella directory of a monorepo was the first thing
    offered on every task. Comparing scores cannot separate them, because the parent's score IS the
    children's. So the test is structural, not numeric: `--in packages/compiler-core` is a strictly more
    useful instruction than `--in packages`, and the refusal already tells the reader they may widen.
    """
    rows = list(ranked)
    paths = {r[0] for r in rows}
    out = [r for r in rows if not any(p.startswith(r[0] + '/') for p in paths)]
    return out or rows


def offer(header, ranked, terms=(), hint=None):
    """Rule 2. Print a refusal that can be acted on, and return the exit code.

    `ranked` is (path, count) or (path, count, score, matched terms). The mark names WHICH of the task's
    words were found under the path, because "matches what you asked" was being printed for a directory
    whose only connection to the task was that the repository is named after it — the reader could not
    tell an informative match from a tautological one.
    """
    tset = set(terms)
    print(header + "\n")
    print("  re-run with one of these — best match first:\n")
    for row in drop_ancestors(list(ranked))[:8]:
        path, n = row[0], row[1]
        hits = row[3] if len(row) > 3 else sorted(tset & set(subtokens(path)))
        mark = ('   <- ' + ', '.join(hits[:3])) if hits else ''
        print(f"    --in {path:44.44} {n:6} symbol(s){mark}")
    print("\n  " + (hint or "a stack frame, the file you just read, or the package named in the issue is enough."))
    return 2


def require_scope(g, scope, terms=(), rank=None):
    """Rule 1. Returns None when the scope is usable, or an exit code after printing the correction.

    Three ways a scope fails, and each gets its own answer rather than one generic error: absent, spelled
    for a path the graph does not have, or real but holding nothing that matches the question.
    """
    dirs = dirs_with_counts(g)
    def by_terms(item):
        return -(len(set(terms) & set(subtokens(item[0]))) * 100000 + item[1])
    if not scope:
        # `rank` is the content-derived ordering when the caller could compute one (it needs the scored
        # symbols). Matching the task's words against the DIRECTORY NAME is circular in a monorepo: the
        # package named after the repository matches every issue that states its version, and the packages
        # holding the answer match nothing. Falling back to the name match is still better than nothing
        # when no ranking was supplied.
        return offer("this needs to know WHERE to look: --in <path> is required.",
                     rank or sorted(dirs.items(), key=by_terms), terms)
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
