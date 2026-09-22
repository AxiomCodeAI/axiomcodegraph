# context — from a problem statement, when there is no name yet

Every other verb needs a name you already have: a method, a type, a `file:line`. That is the wrong first
question on an unfamiliar repository, and it is where a run gives up — asked once, the word resolved to
nothing usable, the graph never touched again.

```
axiomcode context "<the task, in your own words>" [<repo>] [--in <path>] [--budget N] [--source]
```

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
