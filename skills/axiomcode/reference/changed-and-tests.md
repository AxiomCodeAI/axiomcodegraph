# changed, test-impact, and the edit hooks


`axiomcode changed` maps a change onto the graph's declarations and says *how* each changed, in every language from the text:
`signature` (parameters added / removed / renamed / retyped — `+reason`, `-x`, `zip: String → Integer` —, the return type),
`body` (only lines inside a method), `field` (its type `String → Integer`, its name, its initializer; `variable` for a name a
script's top-level code assigns; a line of several statements or declarations (`a = 1; b = 2`, `int a = 1, b = 2;`,
`a, b = 1, 2`) is compared one statement at a time, so only the one whose own statement changed is named), `type` (a header: name,
extends / implements, type parameters), `removed`, and `added` lines outside any known declaration (listed, not analysed —
nothing depends on new code yet). By default it reads the working tree against **the commit the graph was built from** (the
build stamps it), so an uncommitted edit is always measured against the tree the graph describes; `--range a..b` reads two
commits (when the graph is at the newer side, the declarations are the new text's and the direction is turned around),
`--staged` the index, `--old/--new/--file` two texts of one file, `--against-head` the working tree against HEAD (what the
edit hooks ask after a rebase or a pull the baseline has not followed yet, so the commits that came in are not counted as
edits). Each line ends with the target `impact` takes for it: the declaration edited, as `file:line` (a name answers for
every declaration carrying it: eight `main`s, two overloads), and `file:line(param)` for a signature with one parameter
changed. `--impact` runs impact on all of them as one change set.

The graph's line numbers are in the text it was indexed from, and the text an edit is read against can be a later one (an
edit made before the background refresh caught up, a range). Each declaration is carried onto that text by a line diff, and
one whose own line was rewritten is found again by what it declares, nearest first. A declaration still written elsewhere
in the new text is not `removed`: a moved one is `body` (moved), and one found only by name, or a field whose line went
while it is still assigned, says `may have changed`. Read that as "look at it", not as a verdict. When the graph's rows and
the text it records disagree (a refresh raced an edit), a `note:` says the declarations were placed by name.

What to pass, and what the answer says when the question cannot be answered the way it was asked:

| situation | ask | what comes back |
|---|---|---|
| uncommitted edits | `changed` · `test-impact` | the edits against the baseline |
| your branch's commits | `changed --range <base>..HEAD` (MCP `range='<base>..HEAD'`) | read from `git merge-base <base> HEAD`, not from `<base>`'s tip: commits the base branch received after you branched are not yours and are left out. A `note: range base: merge-base …` line says so whenever `<base>` has moved. `a...b` means the same; `a` alone is `a..HEAD` |
| committed work, clean tree | `changed` | `no change …` followed by `next: … HEAD is N commit(s) ahead of <ref> — ask --range <ref>..HEAD` |
| a copy without git | `changed` | a refusal: no base to diff against. Name the files instead |
| named files | `changed <file>…` · `test-impact <file>…` (MCP `files=[…]`) | each file's edit; a named file with no edit (or any named file on a copy without git) counts **whole**: every callable declared in it is `named`, and test-impact selects the tests of all of them |
| a file the base does not have | (any) | one line, `added <file> — new file, N declaration(s)`, plus each new declaration something outside the file already calls, with its impact target. Never its parameters or docstring words |
| fixtures, case data, a schema | (any) | named as `outside every indexed language`, never "no change"; test-impact lists the test files whose text names them (the path, the file name, or a quoted directory), as a `[text]` tier, and says when no test names them |
| a file under a case runner's `cases/` (a script beside `cases/` that walks it: `tests/run.py`, `graph/test/<lang>/run-tests.sh`), a golden named for a case, a rule file under the tree a runner's directory mirrors (`graph/<lang>/` for `graph/test/<lang>/`) | (any) | `case data and rules`: the runner's command for that one case, as its usage line spells it (`python3 tests/run.py <case> --lang <lang>`), or the whole runner for a rule file; a fixture's own `test_*.py` there is data, never handed to pytest |
| a file in a FIXTURE TREE under a test root, whatever its name (`fixtures/`, `testdata/`, `TestData/`, `src/test/resources/`, a directory of goldens): a directory a runner or a test names by path, one that holds goldens and no test of its own, a project no build around it includes | (any) | `case data for <runner>`: the script or the tests that name that path (the file, or the nearest directory above it), with their command (`python3 tests/fast.py --lang python`, `pytest tests/test_report.py`, `mvn test -Dtest=...`); a helper that reads it (a conftest.py, a resource reader) stands for the tests beside it. Never a pytest or JUnit line on the fixture, never a test named like the file. `changed` says `case data (...): read by <runner>; run <cmd>; an input, not a test to run` |
| a data file whose file name other files share (`case.json`, `settings.json`) | (any) | that name is no test-name match: only its path (two parts or more) is looked for in test text |

**A lambda is part of what encloses it.** Every lambda a front end declares carries one name (`<lambda>`), so it is never
the declaration an edit is charged to: an edit inside a lambda in a method is that method's `body` change, and one inside a
field's initializer is that field's. A lambda nothing encloses (an entry in a module-level table) is its own `body`
change, named by where it is, `module.<lambda@L15>` or `Owner.method.<lambda@L42>`, and its target is `file:line`; that
name is also a target `impact` and `path` accept. Its parameter list is read from the lambda's own header, so an unchanged
header is never reported as a parameter change. `impact <file>:<line>` on a field, a property, a constant or a type
header line answers for that declaration; a callable written on the line still wins.

`test-impact` also lists an edited or new **test file** as one to run, and adds it to the command. Code that is also run as a
program (`if __name__ == '__main__'`, `static void main`, `Main`) is looked for by name in the tests, since a test that starts
it as a subprocess or drives it from case data has no call edge to it; when no test names it the answer says the selection is
a lower bound for it.

Measured against 270 real fixes (a Java defect-benchmark arena: the fix applied to the buggy files, the declarations it reports
against the benchmark's own scanner's reading of the same hunks, its class-level state expansion taken out): exact
agreement on 255, 465 declarations reported for the scanner's 473 — recall 0.968, precision 0.985. Every remaining
disagreement was read in the diff: the scanner charges an `@Override` line above an *added* method to `<init>` where this
names the method; an anonymous class added inside a method body is "that method's body changed" here (the scanner names
the new anonymous methods from the fixed tree); a renamed method is reported under its OLD name (what callers reference); a
new nested type is named as well as its members; one miss stands — a method extracted from an existing body whose header
lands in a replaced region. Nothing in the tool's answers was bent toward the benchmark: where the two differ, the diff
was the judge.

The plugin's hooks do this without being asked, at every moment an edit can happen (`hooks/enrich.py`, `hooks/changes.py`):
**PreToolUse on Edit / Write / MultiEdit** applies the edit to a copy and, when it changes a signature, a field's type, a type
header or removes a declaration, gives the blast radius *before* the file changes; **PostToolUse on Edit / Write / MultiEdit**
reports every changed declaration after it lands (a body-only edit included); **PostToolUse on Bash** re-reads the working
tree after a command that can modify sources (`sed -i`, `patch`, `git apply / checkout / pull / merge / stash pop`, a redirect
into a source file, a script run); **UserPromptSubmit** is the safety net — whatever changed the tree since the graph's commit
by any means and was not reported yet. Each declaration is reported once per session; each report is `changed` (which
declaration, how) and `impact` (up to three declarations in parallel, a few lines each: what must change with it — for a
signature, a field, a type or a removal —, who produces or writes it, who reads it, how many callables and tests reach it,
the unresolved-call bound). That is where the agent that changed `String zipCode` to `Integer` is told, before the edit
lands, about the five `getZipCode().length()` uses in another service, the generated constructor call in a controller, and
the four repositories that deserialize a holder.

**Does it find what it says it finds?** `tests/run.py` at the repository root: a synthetic project per behaviour under
`tests/cases/<language>/<name>/`, each with the claim it checks, what must appear in the answer and what must not. It
covers the shapes that used to be answered wrongly: a `this.field` write in an unrelated class, an enum member against a
nested type of the same name, an overload written by its parameter type (`Store.get(String)`), a Java text block and a
JavaScript regex literal, `holds` scoped to the declaring type, a subtype contract where the engine emits no override
rows, a Python `@property` as a private field's door, a house decorator that wraps `dataclass`, and a local variable
that must not carry the method's blast radius. Java, Python, TypeScript, JavaScript and C#.

**Is what the hooks put in context true?** `hooks/validate.py <repo>` generates events (Reads of whole files and ranges, Greps of
declared identifiers, edits that change a body, a signature, a field's type — before and after landing) or replays recorded
ones (every hook block is logged in full with its input in `.axiomcode/hooks.jsonl`), and checks every stated fact against
`graph.sqlite` and the source: each callable named is declared at that line in that file (or the block says the file changed
since the graph was built — the Read block now says so), each caller / callee named has an edge, each count is the table's,
each changed declaration spans a changed line, each name under must-change / produces / reads is in `impact`'s answer with
that role. On a multi-module Java system 1,036 facts, 0 wrong; on a JVM parser 2,693 facts, 0 wrong — after it found two real errors: an
enum's synthesised `values()` / `valueOf()` listed as callables "at L3", and a field named like its fluent accessor handed to
`impact` without its kind. What the hook cannot vouch for is what the graph cannot: an edge the engine did not resolve is
absent, never wrong, and the `? n` count says how many.

## test-impact — which tests this edit reaches

`axiomcode test-impact` takes the edit (the working tree by default, `--range a..b`, `--staged`, or named files), maps it onto the
declarations through `changed`, asks `impact` which tests reach any of them, and prints the test files with the
runner command that runs exactly those. It is `changed` + `impact --tests` with the answer shaped for a pipeline
rather than for a reader.

**What it costs and what it saves, measured end to end** on a TypeScript library of 311 source files whose suite is
130 files and 5,193 tests: a one-line body edit to one function → the answer in **0.74 s**, naming 8 files / 503
tests, and running exactly those took **2.2 s against 17.3 s for the whole suite — 7.9× faster**. Against the
behavioural truth for that method (break it, run the suite, record which files newly fail) the selection contained
**every failing file**, with 2 extra. Over 16 such methods: recall 0.778, precision 0.636, mean 4.1 files of 130.

**It is a lower bound and the wording says so, because the two questions want opposite things.** For "what must be
looked at again", recall is the product and a wide answer is safe. For "what can CI skip", precision is the product
and a wide answer is worthless — and the same answer cannot be tuned for both: on a Python web framework the
registration-key hop takes recall 0.564 → 0.727 and precision 0.527 → 0.310 at the same time. So the rungs are
reported separately and `--json` carries `certainty` per test, and a pipeline can price them: on the TypeScript
library a `[sound]` route (every hop a single resolved target) was right **29 times in 30**, `[one of a set]` 1 in 8,
`[by name]` 0 in 1; a `[fixture]` route is right 30 times in 30 on a service where a fixture is the only way in and
about 1 in 4 on a framework where every test builds an app. Run the sound rung first, and decide about the rest with
the number in front of you. Skipping what it does not name is a decision about risk that this tool cannot make for
you: a test reached only through reflection, a service loader, a subprocess, or a case built at runtime does not appear
here (the `[text]` tier above recovers the ones whose test names the file it loads).

A test that only **stubs** a changed declaration on a mock (`when(repo.find(1))`, `mock.Setup(r => r.Find(1))`) is not
selected for a body edit: it runs none of the body. It is named on a `not selected:` line, and it is selected when the
change is a signature change or a removal, which breaks the stub. A test that reaches the change only through a
framework-entered entry point (an HTTP route, an event, a mediator send) is named on a `NOT COUNTED` line, with the
search that finds it, unless a `[by key]` route already joined it.

