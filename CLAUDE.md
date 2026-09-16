# Working in this repository

## Benchmarks and corpora

**Do not use `cwe-bench-java`.** The checkout under
`~/Documents/Harvard/Benchmark/cwe-bench-java` was deleted on 2026-09-16 and must not be
re-cloned or analysed: its runs saturated the machine (load average 117, with six
concurrent Souffle compiles) and starved the JavaScript and Java issue work of CPU for
hours. If you need a Java benchmark, use `bench/oss` (jsoup, 4 s solve) or the corpora
named in the language READMEs instead, and run one heavy analysis at a time.

The JavaScript corpora live outside the repo: dev tiers under
`~/Documents/AxiomCode/js-corpora/<tier>/<project>`, held-out under
`~/Documents/AxiomCode/js-corpora-holdout/holdout/{ghost,vue}`.

## Cost of an engine change

Editing any rule in `graph/<lang>/engine/` or `graph/<lang>/souffle/` changes the content
hash of the rule set, so `souffle -g` regenerates a ~5.8 MB C++ file and `clang -O3`
rebuilds it: about five minutes on an idle machine, far longer under load. The Datalog
solve itself is usually seconds (express 1 s, mocha 2 s, ghost 7 s). Plan rule work around
the compile, not the solve: batch rule edits, keep one heavy job running at a time, and
read `Elapsed (solve)` only from a run whose log says `reusing cached binary`.

A worktree compiles its own binary even for byte-identical rules, because the cache key
covers the generated program's absolute include paths.
