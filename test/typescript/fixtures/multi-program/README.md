# multi-program fixture

Two shapes that both make the parser analyse more files than it publishes, and which must
be treated differently. `tools/lib-staging.sh` decides which is which; this asserts it.

`dep/` — SIBLING PROGRAMS. `dep/alpha` and `dep/beta` each carry their own
`package.json`, which is how a published package exposes subpath entry points so that
`require('<pkg>/<sub>')` resolves. A single parser invocation over `dep/` analyses both
and publishes one, with no `skipped-typescript-files.csv` entry for the other. Those
declarations are genuinely lost, and staging the siblings recovers them. This is #230.

`dual/` — A DUAL-FORMAT BUILD. `dual/esm/index.d.ts` and `dual/cjs/index.d.cts` are the
same declarations in two module formats, and neither carries its own manifest. The parser
publishing one of them is CORRECT. Staging both would put every declaration in twice,
send each site `multi_inferred`, and score the copy the compiler did not name as WRONG —
which is what staging `typescript` and `typescript/lib` as separate roots did, taking
WRONG from 115 to 384.

Measured on the corpus: every observed shortfall was the `dual/` shape, and the two files
were byte-identical. So the distinction is not hypothetical, and getting it backwards
would trade a silent gap for wrong answers.
