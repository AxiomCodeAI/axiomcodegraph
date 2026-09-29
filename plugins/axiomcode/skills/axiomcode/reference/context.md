# context — from a problem statement, when there is no name yet

Every other verb needs a name you already have: a method, a type, a `file:line`. That is the wrong first
question on an unfamiliar repository, and it is where a run gives up — asked once, the word resolved to
nothing usable, the graph never touched again.

```
axiomcode context "<the task, in your own words>" [<repo>] [--in <path>] [--budget N] [--source]
                  [--explain | --no-explain] [--from <name>]… [--no-refresh]
```

**Read-only:** `--no-refresh` (MCP `context`: `refresh=false`, or `AXIOMCODE_NO_REFRESH=1`) answers from the graph as it is and
never starts a rebuild; rows in files edited since are still marked. Without it, a query on a graph that is out of
date (files edited since, or built by another axiomcode) starts a background rebuild with this axiomcode's engine and
says so on the answer's first line, with the reason.

Deterministic — no model, no embedding index, no network. The task text is split into content terms
(stopwords dropped, camelCase and snake_case split); every symbol is scored against them — exact name,
prefix, substring, then file path — each weighted by inverse document frequency over the graph's own
vocabulary, so a rare term outweighs a common one. A test or benchmark declaration is demoted, not
dropped. The best seed per term is kept, so a multi-concept task gets several entry points; the closure
is walked from those seeds and ranked by nearest hop, then by how many of the task's terms the file
matches — not by how many methods it happens to contain.

`--budget N` is how many files are listed (12 by default). The ranking does not depend on it: a larger
budget only shows more of the same tail, and the footer always says how many were withheld.

`--in` is **repeatable and takes a list**: `--in a --in b` or `--in a,b`. A path you supply is knowledge —
a stack frame, the file you just read, the package named in the issue — so it does restrict the answer;
several are **combined, not intersected**, which is what makes a change spanning two roots answerable in
one call. A scope this program offered comes back marked `--in-offered` and does not restrict at all,
because that one is its guess and not your knowledge.

It ends by saying what it could not see. A partial list that reads as complete is what turns a five-file
change into a one-file patch.

## How something works: the call flow

A task that asks how something works ("how does …", "explain …", "walk through …", "what happens when …", or
`--explain`) also gets the call flow. It starts at `--from <name>` (repeatable) when you know where the mechanism
begins, and otherwise at the entry points above. The steps are chosen breadth-first, so the entry point's own
calls come before any call of a call, and they print as a tree in the order the calls are written. Each step shows
its edge's certainty (`→` resolved, `⇢` one of a set) and the line that makes the call. A `⚠` marks a call in the
step's body that the graph could not resolve, when the project declares that name, so the reader continues
through it instead of stopping. A one-of-a-set site with many candidates is not a step.

Where the flow leaves the graph it says so on that step, rather than ending silently: `⚠ leaves the graph: Send() L11`
for a library call that hands the work on (send, publish, dispatch, persist, execute, a client stub's `…Async`), and
`⚠ no body in the graph (interface/abstract)` for a step with no code to follow, naming the mapper XML statement bound
to it when there is one. Read from there by hand; a leaf whose library calls hand nothing on is not marked.

## What the question names

Entry points start with what the question NAMES: a declaration it spells out (`IRouter.RouteAsync`, `loadByNumber`)
and a route it quotes (`GET /api/widgets`, at the handler registered for it). Then the symbols matching several of
its terms together, then each term left over. Words about code rather than about the subject (`code`, `tests`,
`call`) take no seed, and an inflected word (`validated`) meets the declaration (`Validate`, `…Validator`).

A file, directory or language the question names that no graph here holds is said FIRST, as
`not indexed: <path> (<why>) -- this answer cannot see it; grep it directly`, and `next:` points at it. In a
repository with a graph per language, a question naming one language is answered by that graph alone.

A question about SQL, configuration or templates lists the text files that name the declarations found (a MyBatis
mapper XML whose namespace is the declaring type ranks first), marked as text bindings, not call paths. `--in` on
a directory that holds no source (`src/main/resources`) is accepted: it says so and lists what under it binds.

With `--source`, the earliest steps carry their code within a budget and the later ones are named only, so the
answer comes back on one page. Answer from that code, and open a file only for a step whose body was cut or at a
`⚠`. A question that does not ask how something works gets the ranked answer above, unchanged.
