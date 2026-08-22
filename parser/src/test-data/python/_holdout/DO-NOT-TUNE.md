# HOLDOUT — sealed. Do not read, tune against, or add to.

**A0 owns this. A3 must not open it.**

Every other corpus in this repo is one the parser has been iterated against. That
makes them training data: a number measured on them says how well the parser fits
what we already fixed, not how well it handles code nobody anticipated.

This directory is the control. It is **closed-world** like `closed-world/` — every
callee is declared inside it, no stdlib imports, no builtin receivers, no `getattr`
— so its ceiling is exactly 100% and an unresolved call is unambiguously a defect.
But its *shape* is deliberately different: different domain, different idioms,
written without reference to any defect we have already found.

## The rule

Run it **once**, when the visible corpora are near their ceiling. If it scores far
below them, the difference is overfitting, and that number is the only honest
estimate of how the parser handles unseen code.

Reading it early costs the measurement permanently. There is no way to un-see it.

## Seal

`SEAL.json` holds a SHA-256 per file. `holdout-gate.ts --verify` recomputes them.
A changed hash means the corpus was edited — at which point its result means
nothing and it has to be replaced, not repaired.
