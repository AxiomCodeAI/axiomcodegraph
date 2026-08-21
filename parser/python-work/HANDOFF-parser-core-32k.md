# Handoff: tree-sitter 32,767-char limit — parser-core, NOT owned by the Python fleet

**Found by:** A0 (Python oracle) while sweeping a corpus. **Owner: unassigned — needs one
outside A0–A5.** It is language-agnostic, it affects Java today, and the Python fleet should
not absorb it.

## The measured facts

Binary-searched against `tree-sitter@0.21.1` + `tree-sitter-python@0.21.0`:

```
parser.parse(<string>)         largest OK = 32767   first FAIL = 32768   -> "Invalid argument"
callback-returned chunk        largest OK = 32767   same ceiling
```

**32767 = 2^15 − 1.** A signed-16-bit boundary in the Node binding, not a heuristic. The
in-repo comment at `src/parsers/java/java-parser.ts:36` says "fails around 32-35KB" — the
real number is exact, and worth stating exactly.

It is a **character** limit, not bytes: 29,000 chars of CJK (62,144 bytes) parses fine, so
the existing char-based threshold is measuring the right quantity. I initially assumed a byte
limit and had to discard that hypothesis.

## What is NOT the fix

**Do not split the source and parse the pieces.** That yields N disconnected trees with no
module root, so anything chaining off module/scope containment is wrong, and a construct
spanning a boundary is mangled *without an ERROR node*. Note: on `argparse.py` a naive
2-way split produced identical class/method counts to the correct parse — so this failure
mode does **not** reliably announce itself in smoke tests.

## What IS the fix — already correct for Java

Streaming callback input: one tree, fed incrementally. `java-parser.ts:43` already does this
above 30,000 chars with 8KB chunks. Verified on an 89,228-char file: chunk sizes 1024 and
8192 both give `root=module`, `endIndex=89228`, 127 `function_definition`s, 0 ERRORs.

## Residual risks for the owner

1. **Chunk size is itself capped at 32767.** A callback returning 65536 throws. `8192` is
   safe; a future "optimisation" raising it past 32767 reintroduces the bug.
2. **Only 8% headroom.** The 30,000 threshold sits 2,767 chars under the ceiling. Safe today;
   worth a named constant with the derivation, not a bare literal.
3. **`withRetry` masks it.** The failure is deterministic, but it is retried 3× with
   exponential backoff (`java-parser.ts:56`), turning a hard error into a slow one.
4. **Duplicated per language.** Python will need the identical logic. The threshold, the chunk
   size and the streaming helper belong in one shared parser-core utility, not copied per
   grammar — which is the actual reason this needs an owner.

## Not a Java bug today

30,000 < 32,767, so Java is correct as written. This is hardening plus a shared-utility
refactor, not an incident.
