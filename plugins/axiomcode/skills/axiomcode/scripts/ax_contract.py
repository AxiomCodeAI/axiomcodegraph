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
import collections, difflib, re, sys

SPLIT = re.compile(r'[^A-Za-z0-9]+')
CAMEL = re.compile(r'[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+')
TESTY = re.compile(r'(^|[/_.-])(test|tests|spec|specs|__tests__|benchmark|benchmarks|bench|fixture|fixtures|mock|mocks|e2e)([/_.-]|$)', re.I)


DELIM = re.compile(r'<\s*(issue|task|ticket|bug|problem|request)\s*>(.*?)<\s*/\s*\1\s*>', re.S | re.I)


def headline(text):
    """The first line that says what the problem IS, without the reproduction that follows.

    A report is a claim followed by evidence: one line naming the symptom, then a repro, a stack, a
    playground link, a screenshot. The evidence is where a package gets NAMED for reasons that have nothing
    to do with where the fix goes -- a version field, a URL, a base64 payload, the framework's own name.

    Measured over 9 tasks, this matters for one of the two questions and not the other:
      choosing WHICH package        title alone 55%, title with body 33%
      ranking files WITHIN it       title alone 42%, title with body 53%
    So the headline picks the place and the whole text ranks inside it. Dropping the body everywhere would
    have traded eleven points of file recall for twenty-two points of scope accuracy.
    """
    for line in (text or '').splitlines():
        line = line.strip().lstrip('#').strip()
        if len(line) >= 12: return line
    return text or ''


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


# A declaration the PARSER names, which the source never does. Two kinds, and only one is noise:
#
#   type-level   <function-type>, <call-signature>, <construct-signature>, <constructor-type> — a signature
#                in a type annotation or an interface. It has no body, nothing calls INTO it, and a reader
#                told to go and look at "<function-type>" has been told nothing.
#   container    <module>, <classbody> — the file or the class itself. Every file has one; on Python every
#                class has one too, so a third of an entry-point list can be these.
#
# NOT here, deliberately: <arrow>, <function-expression>, <constructor>. Those are real callables with
# bodies — an anonymous callback is where a vitest or jest test LIVES, and dropping them would empty the
# test layer. The line is whether there is code inside, not whether the name is angle-bracketed.
SYNTHETIC = frozenset({'<function-type>', '<call-signature>', '<construct-signature>',
                       '<constructor-type>', '<module>', '<classbody>'})


def is_synthetic(name):
    """A name the parser invented for a construct with no body — never a place to send a reader."""
    return (name or '') in SYNTHETIC


def subtokens(s):
    """`onUnmountedHook` -> on unmounted hook; `api_create_app` -> api create app; a path -> its segments."""
    out = []
    for part in SPLIT.split(s or ''):
        for m in CAMEL.findall(part):
            if len(m) > 1: out.append(m.lower())
    return out


# The task's own words, shared by the verb that answers a question and by the hook that annotates a file
# the agent opened. Both need to know what the work is ABOUT, and a copy in each would drift.
# Question words and prose glue. A task is mostly English; the code words are the signal.
STOP = set("""a an and are as at be been being but by can cannot could did do does doing done for from get
gets getting had has have how i if in into is it its just like make makes making may might must no not of
on once only or other our out over own same should so some such than that the their them then there these
they this those through to too under until up use used uses using very was way we were what when where
which while who why will with would you your about after all also am any because before below between both
during each few further here him his more most no nor now off other own s same t too very
bug issue fix fixed fixes broken break breaks error fails failing failure problem regression expected
actual reproduce reproduction repro steps version
""".split())



HYPHEN = re.compile(r'[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)+')


def task_terms(text):
    """The content words of the task, in order, deduped.

    A fixed stoplist is a prior about ENGLISH, and the vocabulary here is a codebase's. `v-for` and `v-if`
    are Vue's two most distinctive directive names, and splitting them on the hyphen leaves `v` (too short)
    and `for`/`if` (stopwords) — so the single most discriminating word in an issue was being deleted before
    scoring, while a file literally named vFor.ts sat in the answer. The compound is kept WHOLE and
    unhyphenated alongside its parts, so `v-for` still reaches `vFor`; IDF then decides what a term is
    worth, which is a judgement about this graph rather than about English.
    """
    words, seen = [], set()
    def add(w):
        w = w.lower()
        if len(w) < 3 or w in seen: return
        seen.add(w); words.append(w)
    for compound in HYPHEN.findall(text or ''):
        add(re.sub(r'[-_.]', '', compound))          # v-for -> vfor, api_create_app -> apicreateapp
    for raw in SPLIT.split(text or ''):
        if not raw: continue
        add(raw)
        for part in CAMEL.findall(raw): add(part)
    content = [w for w in words if w not in STOP]
    return content or words


# A term the graph has never heard of cannot match anything, and a term half the graph uses cannot
# discriminate -- yet both counted toward the coverage denominator. A real task carries a lot of both: a
# reproduction link's base64 payload and an image hash are zero-frequency, and the prose around an issue is
# high-frequency. One measured task arrived as 264 terms of which about a dozen were about the bug.
#
# Swept over 18 tasks on three languages: 8 or 12 terms scores 44%, 16 scores 50%, 24 scores 61%, and 40 or
# unbounded 55%. Anything from 16 up is within a task or two of the best, so 24 is a knee and not a cliff.
# An explicit "drop any term more common than X of the graph" threshold was also tried and DELETED: it
# changed nothing at any value between 5% and 100%, because sorting by document frequency and keeping the
# first MAX_TERMS already drops exactly those words.
MAX_TERMS = 24


def winnow(g, terms, name_df=None):
    """The terms worth scoring, most discriminating first — by the graph's own document frequency."""
    if name_df is None:
        name_df = collections.Counter()
        for sid, sym in g.sym.items():
            for t in set(subtokens(sym.get('name') or '') + subtokens(sym.get('display') or '')):
                name_df[t] += 1
    keep = [t for t in terms if name_df.get(t, 0) > 0]
    keep.sort(key=lambda t: name_df.get(t, 0))
    # order is the caller's contract elsewhere (seeds are picked per term in task order), so restore it
    chosen = set(keep[:MAX_TERMS])
    return [t for t in terms if t in chosen] or terms[:MAX_TERMS]


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


def offer(header, ranked, terms=(), hint=None, flag=''):
    """Rule 2. Print a refusal that can be acted on, and return the exit code.

    `ranked` is (path, count) or (path, count, score, matched terms). The mark names WHICH of the task's
    words were found under the path, because "matches what you asked" was being printed for a directory
    whose only connection to the task was that the repository is named after it — the reader could not
    tell an informative match from a tautological one.

    `flag` is appended to every printed re-run line. A path the CALLER supplies is knowledge — a stack
    frame, the file it just read — and a verb may treat it as certain. A path offered HERE is this
    program's guess, and the two used to arrive at the verb as the same `--in` argument with no way to
    tell them apart, so a guess was being applied with the authority of knowledge. The flag is how the
    provenance travels with the value.
    """
    tset = set(terms)
    print(header + "\n")
    print("  re-run with one of these — best match first:\n")
    for row in drop_ancestors(list(ranked))[:8]:
        path, n = row[0], row[1]
        hits = row[3] if len(row) > 3 else sorted(tset & set(subtokens(path)))
        mark = ('   <- ' + ', '.join(hits[:3])) if hits else ''
        print(f"    --in {path:38.38}{flag} {n:6} symbol(s){mark}")
    print("\n  " + (hint or "a stack frame, the file you just read, or the package named in the issue is enough."))
    return 2


def sole_scope(g):
    """The only directory this graph could be scoped to, or None when there is a real choice.

    `require_scope` refuses without `--in` so the CALLER picks the package, which is right
    whenever there is something to pick. When the structural menu holds exactly one row there
    is nothing to pick: the refusal spends a round trip to be told the one path it had already
    ranked and already term-matched. A flat package leaves one row, and so does a package with
    a single subpackage; two subpackages leave two, and those still refuse.

    The test is the repository's own structure, never where the task's words landed. A
    ten-package tree whose words happen to fall in one package is still a choice, and guessing
    it is exactly what `--in` exists to prevent. That is also why this one is not `--in-offered`:
    a sole row is not a guess between candidates, and filtering on it removes nothing, because
    every indexed file is already under it.
    """
    rows = drop_ancestors(sorted(dirs_with_counts(g).items()))
    return rows[0][0] if len(rows) == 1 else None


def best_scope(ranked):
    """The top row of a menu this program ranked, or None when the ranking has no evidence to rank on.

    `sole_scope` answers when the layout leaves nothing to pick. This answers when it leaves several and
    the CALLER still has nothing to pick with — the shape the prose verbs exist for, an issue and no
    symbol. A conventional Maven or Gradle tree always offers at least a main and a test root, so the
    sole-row case never reaches an ordinary project and the refusal was what an issue-shaped question got.

    Refusing was defensible only while the refusal was cheap for the caller to repair. It is not: the
    caller who has a scope to name passes `--in` already, and the caller who does not is handed a menu
    this program ranked, term-matched and then declined to act on. The rank is the same one `offer` would
    have printed at the top.

    The evidence test is why this is not the guessing `--in` exists to prevent. A row scores only when the
    task's own words land in the names of the symbols under it, so a zero top row means no directory is
    about the question and there is no "best" to take — that still refuses. And the row this returns is
    NOT knowledge: the caller marks it `--in-offered`, which by rule 2 does not filter, so a wrong guess
    costs the reader a line of text and never an answer.
    """
    rows = drop_ancestors(list(ranked))
    if not rows: return None
    top = rows[0]
    score = top[2] if len(top) > 2 else 0
    return (top[0], len(rows)) if score > 0 else None


def require_scope(g, scope, terms=(), rank=None, flag=''):
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
                     rank or sorted(dirs.items(), key=by_terms), terms, flag=flag)
    if not g.q("SELECT COUNT(*) n FROM symbols WHERE file LIKE ?", f'%{scope}%')[0]['n']:
        # A path that is not in the graph is usually a TYPO, and a typo is a character-level miss, not a
        # token-level one: `complier-core` shares exactly the same two tokens with `compiler-core` as with
        # `runtime-core`, so token overlap ties them and the tiebreak by symbol count then answered with
        # whichever package was larger. Similarity over the whole string is what the question is asking.
        want = set(subtokens(scope))
        def near_key(d):
            ratio = difflib.SequenceMatcher(None, scope, d[0]).ratio()
            return -(len(want & set(subtokens(d[0]))) + ratio)
        near = sorted(dirs.items(), key=near_key)
        return offer(f"no indexed file has '{scope}' in its path.", near, terms,
                     hint="check the spelling against these, or widen to the package above it.", flag=flag)
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
