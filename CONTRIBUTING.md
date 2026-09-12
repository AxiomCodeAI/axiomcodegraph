# Contributing

## The short version

`main` is not writable. Every change arrives as a pull request from a branch, is
reviewed, and merges only when CI is green.

## Before you write code: open an issue

Not only for large changes — for every change. The issue is where the measurement
that found the problem lives; the pull request is only the fix. This repository runs
several people and agents against different front ends at once, and issue-first is
what keeps that legible.

Pick the template that matches: engine defect, parser-blocked, harness, enhancement.

## Describing a defect

**Use a synthetic example. Never name the project you found it in.** No identifiers,
no file names, no pasted code from a real codebase — in issues, pull requests, or
commit messages. Reduce it to `class Widget`, `pkg/_helpers.py`, `options: "Options"`
and describe the mechanism: what the rule joins on, why the join fails, what the fix
is.

The tracker is a durable record. Naming someone's codebase turns a bug report into a
benchmark claim about their code, which is not what this is.

Keep the corpus measurement out of the prose too. Describe the defect by mechanism,
not by what it cost on some project.

## Branches

Short-lived, cut from `origin/main`, named for the front end they touch:

    java/...        python/...        typescript/...
    test/...        parser-blocked/...

Squash merge, and the branch is deleted on merge. There is no long-lived `dev` or
`staging` branch: this is a library, nothing deploys from it, and release stages are
git tags. A forward-merge tax buys nothing here.

**Work in a `git worktree`, not the shared checkout.** More than one agent works this
tree at a time and it switches branches underneath you.

    git fetch origin
    git worktree add ../wt/my-change -b python/my-change origin/main

Cut from `origin/main`, never from the local `main` ref — it is not fast-forwarded by
the squash merges and drifts arbitrarily far behind. A baseline cut from a stale
`main` has produced a "collapse" that was entirely the baseline.

## Running the tests

The suites need two things that are not in this repository: Soufflé, and a built
parser.

    brew install souffle            # or: apt-get install souffle

    git clone git@github.com:AxiomCodeAI/parser.git ../Parser
    cd ../Parser && git checkout "$(grep -v '^#' ../axiom-code-graph/.github/parser-ref | head -1)"
    npm ci && npm run build

Then, from this repository:

    export AXIOM_PARSER="$PWD/../Parser/dist/index.js"
    bash test/java/run-tests.sh
    bash test/python/run-tests.sh
    bash test/typescript/run-tests.sh

**A suite that prints `SKIP` has not passed.** It exits 77 when it cannot find the
parser. CI treats that as a failure, and so should you — a green run that tested
nothing is the most expensive kind.

### The parser is pinned

`.github/parser-ref` names the exact parser commit CI builds and scores the goldens
against. The goldens are a function of both the rules and the IR, so tracking the
parser's `main` would let a change in the other repository turn this one red with no
commit here to point at.

To move the pin: change the SHA, run all three suites against that exact build, and
put both in one pull request. A nightly workflow runs against the parser's `main` and
opens an issue when the pin has fallen behind, so it cannot rot unnoticed.

### Re-blessing a golden

`--bless` regenerates goldens from the current engine. It is not a way past a red
check. A golden that moves is a change in resolution power and belongs in the pull
request diff with an explanation of which edges changed and why each is correct now.

The CPython ground truth cannot be re-blessed from here at all — it lives outside the
repository, on purpose.

## Never modify parser code from here

The engine is read-only with respect to the parser. A missing fact is filed as
`parser-blocked`, with three things: the parser source that drops it, a synthetic
input that reproduces it, and the real construct it came from. Without all three it
is a hypothesis, not a defect.
