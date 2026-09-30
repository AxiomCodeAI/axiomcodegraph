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
import collections, difflib, os, re, subprocess, sys, time

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
code codebase call calls called calling caller callers callee callees test tests
""".split())
# The last line is the words a question uses to talk ABOUT code rather than about its subject: "who calls X in the
# library code (not tests)" named `code`, `tests` and `call`, and each took one of six entry points (GetHashCode,
# Retry.Tests, Retry.Call) away from the declaration the question spelled out (#1455).


def stem(w):
    """A crude English stem, enough to meet a declared name halfway: validated, validator, validation and validate
    are all `valid`; orders and ordered are `order`. One suffix at most, and never below four letters, so a short
    word is never cut into a different one (`order` stays `order`, not `ord`)."""
    w = (w or '').lower()
    for suf in ('ations', 'ation', 'ators', 'ator', 'ated', 'ates', 'ate', 'ings', 'ing', 'ions', 'ion', 'ers', 'ors',
                'ed', 'es', 'er', 'or', 's', 'e'):
        if w.endswith(suf) and len(w) - len(suf) >= 4:
            w = w[:-len(suf)]; break
    # a doubled final consonant is one: cancelled -> cancel, stopped -> stop (and install -> instal on both sides)
    if len(w) >= 5 and w[-1] == w[-2] and w[-1] not in 'aeiou':
        w = w[:-1]
    return w



HYPHEN = re.compile(r'[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)+')

# A REPORT MARKS ITS OWN CODE WORDS, AND THE SCORER WAS IGNORING THE MARKS.
# Terms were ranked by graph document frequency alone, so a RARE PROSE word beat a COMMON CODE word:
# on one issue the kept terms were `gaps · var · work · open · code · parser`, the best entry point was a
# Gradle extractor matching "gaps" on a Python task, and the two files the fix actually touched ranked
# 44th and 46th of 111. Handing the same command that issue's code words instead moved them to 1st and
# 11th -- same graph, same repo, only the terms differed.
# A writer already distinguishes the two: code goes in backticks or a fence, and identifiers carry
# underscores, camelCase or ALL_CAPS. Those are evidence about THIS text, where document frequency is
# only evidence about the graph, so they are collected separately and take the budget first.
FENCED = re.compile(r'`{1,3}([^`]+)`{1,3}|^\s{4,}(\S.*)$', re.M)
IDENTLIKE = re.compile(r'^(?:[a-z]+[A-Z]\w*|[A-Z][A-Z0-9_]{2,}|\w*_\w+)$')


def code_terms(text):
    """The terms a report itself marked as code: inside backticks or an indented block, or shaped like an
    identifier anywhere. Returned lowercased and split the same way task_terms splits, so the two lists
    are comparable."""
    out, seen = [], set()
    def add(w):
        w = (w or '').lower()
        if len(w) < 3 or w in seen or w in STOP: return
        seen.add(w); out.append(w)
    spans = [a or b for a, b in FENCED.findall(text or '')]
    for raw in SPLIT.split(' '.join(spans)):
        if raw:
            add(raw)
            for part in CAMEL.findall(raw): add(part)
    for raw in SPLIT.split(text or ''):          # identifier-shaped tokens outside any fence
        if raw and IDENTLIKE.match(raw):
            add(re.sub(r'[-_.]', '', raw))
            for part in CAMEL.findall(raw): add(part)
    return out


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


def winnow(g, terms, name_df=None, strong=None):
    """The terms worth scoring, most discriminating first — by the graph's own document frequency."""
    if name_df is None:
        name_df = collections.Counter()
        for sid, sym in g.sym.items():
            for t in set(subtokens(sym.get('name') or '') + subtokens(sym.get('display') or '')):
                name_df[t] += 1
    # A term is kept when the graph declares it, or declares a word with its stem: the prose says "validated" where
    # the code says `Validate` and `CreateWidgetCommandValidator`, and dropping the word here meant the validator was
    # never scored at all (#1493). score_symbols already credits the inflected form; it just never got to see it.
    stems = {}
    for x in name_df:
        if len(x) >= 4: stems.setdefault(stem(x), 0); stems[stem(x)] += name_df[x]
    df_of = lambda t: name_df.get(t, 0) or (stems.get(stem(t), 0) if len(t) >= 5 else 0)
    keep = [t for t in terms if df_of(t) > 0]
    # the report's own code words first, still ordered by how much they discriminate, then prose fills the
    # rest of the budget. Only terms the graph actually knows are eligible either way -- a code word the
    # graph has never heard of still cannot match anything.
    marked = set(strong or ())
    code = sorted([t for t in keep if t in marked], key=df_of)
    prose = sorted([t for t in keep if t not in marked], key=df_of)
    chosen = set((code + prose)[:MAX_TERMS])
    # order is the caller's contract elsewhere (seeds are picked per term in task order), so restore it
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
    if not hint and len(drop_ancestors(list(ranked))) > 1:
        # a change that spans two of these is answerable in ONE call, so say so here rather than letting the
        # reader assume the rows are alternatives (#1029)
        print("  more than one is allowed: --in a --in b, or --in a,b — they are combined, not intersected.")
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


def scope_spec(scope, repo='.'):
    """(the scope as the index writes paths, whether it is a PATH) — how `--in` is matched (#1584).

    A scope used to match any file whose path CONTAINED it, so `--in tests` in a repository with a top-level tests/
    also took `parser/src/tests-util/…` and `graph/contests/…`: a directory name is a substring of many paths that
    are not under it. A scope that names a file or directory of the repository is that path, and matches by prefix;
    one that names nothing there (`pkg`, a fragment of a package name) is still matched anywhere, as it always was.
    The test is the working tree, not a graph, so every language's graph reads one scope the same way."""
    s = (scope or '').strip().replace('\\', '/')
    while s.startswith('./'): s = s[2:]
    s = s.rstrip('/')
    return s, bool(s) and os.path.exists(os.path.join(repo or '.', s))


def under_scope(f, spec):
    """is file `f` (repo-relative, as the index stores it) inside `spec` (a scope_spec)"""
    s, is_path = spec; f = f or ''
    return (f == s or f.startswith(s + '/')) if is_path else s in f


def scope_sql(spec, col='file'):
    """(the SQL condition, its parameters) that keeps the rows of `col` inside `spec`"""
    s, is_path = spec
    if is_path: return f"({col} = ? OR substr({col}, 1, ?) = ?)", (s, len(s) + 1, s + '/')
    return f"{col} LIKE ?", (f'%{s}%',)


def require_scope(g, scope, terms=(), rank=None, flag=''):
    """Rule 1. Returns None when the scope is usable, or an exit code after printing the correction.

    Three ways a scope fails, and each gets its own answer rather than one generic error: absent, spelled
    for a path the graph does not have, or real but holding nothing that matches the question.

    `scope` is one path or SEVERAL (#1029). A caller holding two roots — a change that spans them, or the
    two best rows of the menu this module prints — had no way to say so: `--in` took one path and applied
    it as a filter, so the second root was excluded by construction and no single call could answer. Each
    path is validated on its own, and a misspelling names ITSELF rather than failing the whole call.
    """
    scopes = [x for x in (scope if isinstance(scope, (list, tuple)) else [scope]) if x]
    dirs = dirs_with_counts(g)
    def by_terms(item):
        return -(len(set(terms) & set(subtokens(item[0]))) * 100000 + item[1])
    if not scopes:
        # `rank` is the content-derived ordering when the caller could compute one (it needs the scored
        # symbols). Matching the task's words against the DIRECTORY NAME is circular in a monorepo: the
        # package named after the repository matches every issue that states its version, and the packages
        # holding the answer match nothing. Falling back to the name match is still better than nothing
        # when no ranking was supplied.
        return offer("this needs to know WHERE to look: --in <path> is required.",
                     rank or sorted(dirs.items(), key=by_terms), terms, flag=flag)
    def held(x):
        cond, params = scope_sql(scope_spec(x, getattr(g, 'repo', '.')))
        return g.q(f"SELECT COUNT(*) n FROM symbols WHERE {cond}", *params)[0]['n']
    missing = [x for x in scopes if not held(x)]
    for scope in missing[:1]:
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


# ── rule 6: a verb ANSWERS ────────────────────────────────────────────────────────────────────────
def ensure_graph(repo, db):
    """The graph a verb needs, built if it is not there yet. Returns True when the graph exists after
    this call.

    Rule 2 says a refusal always carries a correction. "no graph at …/graph.sqlite — run `axiomcode
    index` first" carries one, and it is still the wrong answer: the correction is a command the
    caller can only run by hand, and running it is the whole of what they wanted. It was the last
    manual step between installing the package and getting an answer out of it.

    It is OFF unless AXIOMCODE_AUTOBUILD is set, and the dispatcher sets it — so the CLI and the MCP
    server (timeout 900 s) build on demand, while the plugin's hooks, which shell straight to these
    scripts under timeouts of 10-25 s, do not. A first build takes minutes: under a hook it would be
    killed every time, cache nothing, and repeat on the next edit forever.

    AXIOMCODE_GRAPH points at a graph someone else built and placed; nothing is built into it."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import ax_fresh
    rr = os.path.realpath(repo); auto = os.environ.get('AXIOMCODE_AUTOBUILD')
    # a repository that is not there is an error that names it, never a build: the dispatcher refuses one first, and
    # this holds the same for a verb script run directly
    if not os.path.isdir(rr):
        print(f"axiomcode: no such directory: {repo} (the repository to ask). Nothing was built or asked.", file=sys.stderr)
        sys.exit(2)
    if not os.environ.get('AXIOMCODE_GRAPH'): ax_fresh.relink(rr)     # a pointer into another checkout is not this graph (#1605)
    if os.path.exists(db): return True
    # A BUILD IS RUNNING: wait for it, never start a second one (#1305). The graph (or the baseline graph `changed` reads,
    # or another language's) can be missing for a moment while a build swaps it; a query that took that for "no graph"
    # started a full build of its own, which queued behind the running one and then rebuilt everything again as an
    # explicit index. The hooks, which run under timeouts of seconds, do not wait.
    if ax_fresh.building(rr):
        # a build is running: never a silent wait. Under the MCP server answer at once with the stage it is at; from a
        # shell wait for it, printing the stage as it moves; either way, use the graph the moment it exists
        if auto and not os.environ.get('AXIOMCODE_BUILD_NOWAIT'):
            print(f"a graph build is already running for {repo}; waiting for its first graph …", file=sys.stderr)
            _follow(rr, lambda: ax_fresh.building(rr) and not os.path.exists(db))
        if os.path.exists(db): return _published(rr)
        if auto and os.environ.get('AXIOMCODE_BUILD_NOWAIT'):
            _BUILD_NOTE.append(building_note(rr)); return False
    if not auto or os.environ.get('AXIOMCODE_GRAPH'): return False
    build = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'axiomcode-build')
    if not os.path.exists(build): return False
    import ax_fresh
    bash = os.environ.get('AXIOMCODE_BASH') or 'bash'
    # NEVER A SILENT WAIT. A first build takes minutes (a whole-program solve, and on a machine that has never built this
    # language, a one-time compile of its rules), and it used to run with nothing said after its first line, so a caller
    # could not tell a build from a hang. Under the MCP server (AXIOMCODE_BUILD_NOWAIT) the build is started in the
    # background and the call answers within AXIOMCODE_BUILD_WAIT seconds either way: with the graph when it was quick,
    # else with the stage the build is at, so the agent is told to ask again rather than left waiting past the host's
    # timeout. From a shell the call waits for it, printing the stage as it moves. A call that finds a build already
    # running (another query's, or an `axiomcode index`) reports on that one rather than queueing a second behind it.
    nowait = bool(os.environ.get('AXIOMCODE_BUILD_NOWAIT'))
    if ax_fresh.building(repo):
        if nowait: _BUILD_NOTE.append(building_note(repo)); return False
        print(f"a graph build is already running for {repo}; waiting for its first graph …", file=sys.stderr)
        _follow(repo, lambda: ax_fresh.building(repo) and not os.path.exists(db))
        return os.path.exists(db) and _published(repo)
    env = None
    if ax_fresh.has_graph(rr):
        # a graph WAS built here and its pointer is broken: a repair, which keeps the baseline `changed` and test-impact
        # measure edits against, as the background refresh does. Built as a first index it moved the baseline to the
        # edited tree, and every edit made before it dropped out of `changed`
        # relink above took every pointer that leaves this .axiomcode/out: one still here is this repository's own
        try: gone = f" (.axiomcode/out/graph.sqlite points at {os.readlink(db)}, which is not there)"
        except OSError: gone = ''
        why = "it was corrupt and was moved aside" if os.path.exists(os.path.join(ax_fresh.out_dir(rr), 'corrupt')) else "a build was interrupted"
        print(f"the graph of {repo} is missing ({why}){gone} — rebuilding it; the baseline edits are measured against is kept …", file=sys.stderr)
        env = dict(os.environ, AXIOMCODE_KEEP_BASE='1')
    else:
        print(f"no graph for {repo} yet — building one (this is the only slow call; later ones read it) …", file=sys.stderr)
    if nowait:
        os.makedirs(os.path.join(repo, '.axiomcode'), exist_ok=True)
        log = open(os.path.join(repo, '.axiomcode', 'first-build.log'), 'w')
        p = _start_build([bash, build, repo], log, env)
        # until the build holds its lock a second query would see no build and start another, so that much is always waited
        up = time.time() + 10
        while p.poll() is None and not ax_fresh.building(repo) and time.time() < up: time.sleep(0.05)
        end = time.time() + float(os.environ.get('AXIOMCODE_BUILD_WAIT') or 60)
        while p.poll() is None and not os.path.exists(db) and time.time() < end: time.sleep(0.5)
        if p.poll() is None: return _published(repo) if os.path.exists(db) else (_BUILD_NOTE.append(building_note(repo)) or False)
        return p.returncode == 0 and os.path.exists(db)
    # THE ANSWER WAITS FOR ITS GRAPH, NOT FOR THE WHOLE BUILD (#1555). The build publishes the main language's graph as
    # soon as that language is solved and goes on solving the others under its lock, so the wait ends when graph.sqlite
    # appears. The build writes to a log, copied here to stderr as it comes, not to this process's pipes: a caller that
    # captures them (an agent's shell tool) reads until they close, and a build still solving other languages would hold
    # them open to its end.
    os.makedirs(os.path.join(repo, '.axiomcode'), exist_ok=True)
    logp = os.path.join(repo, '.axiomcode', 'first-build.log')
    with open(logp, 'w') as log:
        p = _start_build([bash, build, repo], log, env)
    shown = [0]
    def relay():
        try:
            with open(logp, 'rb') as f: f.seek(shown[0]); b = f.read()
        except OSError: return
        shown[0] += len(b); sys.stderr.write(b.decode('utf-8', 'replace')); sys.stderr.flush()
    _follow(repo, lambda: relay() or (p.poll() is None and not os.path.exists(db)))
    relay()
    if p.poll() is None: return os.path.exists(db) and _published(repo)
    return p.returncode == 0 and os.path.exists(db)


def _start_build(argv, log, env):
    """the build a query starts, in a session (a process group) of its own, as ax_fresh.kick starts the refresher.

    THE BUILD IS NOT THE QUERY'S (#1555). It goes on solving the other languages after the query has its answer, and a
    query is stopped all the time: a caller's timeout, Ctrl-C, an agent host that ends the command's process group when
    it returns or times out. Started in the query's group, the build was stopped with it -- on a repository in several
    languages, whose first build outlasts a two-minute timeout, before the main graph was published, or while it was
    being indexed, which deleted the solved graph as a failure. No graph.sqlite was left, the next query built again
    from nothing, was stopped again, and every query rebuilt forever. In its own session the build finishes whatever
    becomes of the query; a later query finds it running and waits for it rather than starting another."""
    if os.name != 'nt':
        return subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True, env=env, start_new_session=True)
    # DETACHED | NEW_GROUP, and out of the caller's job object where the job allows it (see ax_fresh.kick)
    for flags in (0x00000008 | 0x00000200 | 0x01000000, 0x00000008 | 0x00000200):
        try: return subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True, env=env, creationflags=flags)
        except OSError: continue
    return subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True, env=env)


def usable_graph(repo, gdir):
    """The graph directory a verb reads: `gdir` itself, unless its graph.sqlite is CORRUPT (a disk that filled, a copy cut
    short). Then it is never read — every verb died in a Python traceback on it — but moved aside and rebuilt: the main
    graph through ensure_graph (a shell waits for it; the MCP server starts it and answers at once), another language's
    in the background. Until the rebuild is in, the last good graph answers (the baseline a refresh kept), and says so
    on a `graph refresh:` line, which the MCP server carries into the answer. With none, the verb stops in words."""
    db = os.path.join(gdir, 'out', 'graph.sqlite')
    if not os.path.exists(db): return gdir
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import ax_fresh
    why = ax_fresh.graph_corrupt(db)
    if not why: return gdir
    return _corrupt(repo, gdir, db, why)


def _corrupt(repo, gdir, db, why):
    import ax_fresh
    rr = os.path.realpath(repo)
    lang = ax_fresh.graph_lang()
    # a graph someone placed with AXIOMCODE_GRAPH is theirs: said, never moved or rebuilt. One of this repository's own
    # language graphs (the dispatcher sets AXIOMCODE_GRAPH to it, with AXIOMCODE_GRAPH_LANG) is ours to repair
    placed = os.environ.get('AXIOMCODE_GRAPH')
    own = not placed or (lang and os.path.realpath(placed) == os.path.realpath(os.path.join(rr, '.axiomcode', 'lang', lang)))
    what = f"the {lang} graph" if lang else "the graph"
    if not own:
        _stop(f"{what} at {db} is corrupt ({why}); AXIOMCODE_GRAPH placed it, so it is not rebuilt here — rebuild it where it was built")
    moved = ax_fresh.quarantine(rr, db, why)
    print(f"graph refresh: {what} at {db} is corrupt ({why}) — " + (f"moved aside to {moved} and rebuilding it" if moved else "rebuilding it"),
          file=sys.stderr, flush=True)
    if not lang:
        if ensure_graph(repo, db) and os.path.exists(db) and not ax_fresh.graph_corrupt(db): return gdir
    elif not ax_fresh.building(rr):
        _rebuild_in_background(rr)
    good = ax_fresh.last_good_graph(rr)
    if good:
        print(f"graph refresh: until the rebuild is in, this answer comes from the last good graph ({good}), which predates "
              f"the edits since it was built", file=sys.stderr, flush=True)
        return good
    _stop(_BUILD_NOTE[-1] if _BUILD_NOTE else
        f"{what} at {db} was corrupt and there is no earlier graph to answer from; a rebuild is "
        f"{'running' if ax_fresh.building(rr) else 'needed'} — ask again when it is done, or run `axiomcode index {repo}`")


def _stop(msg):
    """the verb's refusal, as the verbs' own die() gives it: the words on stdout, exit 2"""
    print(msg); sys.exit(2)


def _rebuild_in_background(repo):
    """start a detached build of the repository, keeping the baseline, as a repair does (another language's graph was
    corrupt; the build rebuilds every language, and the corrupt marker keeps it from calling the tree up to date)"""
    build = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'axiomcode-build')
    if not os.path.exists(build): return
    env = dict(os.environ, AXIOMCODE_KEEP_BASE='1', AXIOMCODE_BACKGROUND='1', AXIOMCODE_REFRESH_REASON='a corrupt graph')
    for k in ('AXIOMCODE_GRAPH', 'AXIOMCODE_GRAPH_LANG', 'AXIOMCODE_FANOUT', 'AXIOMCODE_LANG'): env.pop(k, None)
    try:
        log = open(os.path.join(repo, '.axiomcode', 'refresh.log'), 'a')
        kw = dict(start_new_session=True) if os.name != 'nt' else dict(creationflags=0x00000008 | 0x00000200)
        subprocess.Popen([os.environ.get('AXIOMCODE_BASH') or 'bash', build, repo], stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                         close_fds=True, env=env, **kw)
    except OSError: pass


def on_corrupt(repo, db):
    """A graph that reads cleanly when opened can still hold a malformed page that only a query reaches. Installed by a
    verb once its graph is open: an sqlite error that escapes the verb is checked with quick_check, and when the graph is
    corrupt the verb says so and moves it aside for a rebuild instead of printing a traceback. Any other error is
    reported as it was."""
    prev = sys.excepthook
    def hook(t, e, tb):
        import sqlite3
        if isinstance(e, sqlite3.DatabaseError) and os.path.exists(db):
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import ax_fresh
            why = ax_fresh.graph_corrupt(db, thorough=True)
            if why:
                rr = os.path.realpath(repo); lang = ax_fresh.graph_lang()
                placed = os.environ.get('AXIOMCODE_GRAPH')
                own = not placed or (lang and os.path.realpath(placed) == os.path.realpath(os.path.join(rr, '.axiomcode', 'lang', lang)))
                moved = ax_fresh.quarantine(rr, db, why) if own else ''
                if own and not ax_fresh.building(rr): _rebuild_in_background(rr)
                print(f"{'the ' + lang + ' graph' if lang else 'the graph'} at {db} is corrupt ({why}) — "
                      + (f"moved aside to {moved}; it is being rebuilt, ask again in a minute" if moved else
                         "rebuild it where it was built" if not own else f"run `axiomcode index {repo}` to rebuild it"),
                      file=sys.stderr, flush=True)
                sys.stdout.flush(); os._exit(1)                # SystemExit raised in an excepthook is itself reported
        prev(t, e, tb)
    sys.excepthook = hook


def _published(repo):
    """the main graph is out while the build goes on solving the repository's other languages: the answer is given now,
    and names on stderr (a `graph refresh:` line, which the MCP server carries into the answer) what it cannot see yet"""
    import ax_fresh
    n = ''
    for _ in range(20):                          # the build names what is still to come just before the pointer moves
        n = ax_fresh.note(ax_fresh.status(repo))
        if n or not ax_fresh.building(repo): break
        time.sleep(0.1)
    if n: print(n, file=sys.stderr)
    return True


_BUILD_NOTE = []
TICK = 20.0


def build_stage(repo):
    """(stage, done, of): the last `▶` step the running build's log names, and how many of its languages it has
    started solving, from .axiomcode/build.log"""
    stage, langs, solving = '', [], 0
    try: text = open(os.path.join(repo, '.axiomcode', 'build.log'), errors='replace').read()
    except OSError: text = ''
    for l in text.splitlines():
        if not l.startswith('\u25b6 '): continue
        stage = l[2:].strip()
        if stage.startswith('languages:'): langs = stage.split(':', 1)[1].split()
        elif stage.startswith('solving '): solving += 1
    return stage, solving, len(langs)


def building_note(repo):
    """one line: a graph is being built, what it is doing and for how long, and what to do meanwhile"""
    try: took = time.time() - os.path.getmtime(os.path.join(repo, '.axiomcode', 'build.lock'))
    except OSError: took = 0
    stage, n, of = build_stage(repo)
    where = (f"language {n} of {of}, " if of and n else '') + (stage or 'starting')
    if 'compiling souffle program' in stage:
        where += ' — a one-time compile of this language\'s rules on this machine, a few minutes; later builds reuse it'
    return (f"the graph for {repo} is being built ({where}; {int(took // 60)}m{int(took % 60):02d}s so far). "
            f"Nothing else is needed: ask again in a minute or two, or read the code directly meanwhile. "
            f"Progress: {os.path.join(repo, '.axiomcode', 'build.log')}")


def _follow(repo, running):
    """wait while running(), printing the build's stage to stderr whenever it moves, and every TICK seconds at least"""
    last, said = None, time.time()
    while running():
        time.sleep(0.5)
        stage, n, of = build_stage(repo)
        if (stage and stage != last) or time.time() - said >= TICK:
            try: took = time.time() - os.path.getmtime(os.path.join(repo, '.axiomcode', 'build.lock'))
            except OSError: took = 0
            print(f"  … {'language %d of %d, ' % (n, of) if of and n else ''}{stage or 'starting'} ({int(took)}s)", file=sys.stderr, flush=True)
            last, said = stage, time.time()


def no_graph(repo, db):
    """what to say when there is still no graph after ensure_graph has had its turn."""
    if _BUILD_NOTE:
        return _BUILD_NOTE[-1]
    if os.environ.get('AXIOMCODE_GRAPH'):
        return f"no graph at {db} (AXIOMCODE_GRAPH is set, so nothing was built into it)"
    if os.environ.get('AXIOMCODE_AUTOBUILD'):
        return f"no graph at {db} — the build did not produce one; see {os.path.join(repo, '.axiomcode', 'build.log')}"
    return f"no graph at {db} — run `axiomcode index {repo}` first"
