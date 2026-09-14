# Fluent chains past sixteen links keep their head

A fluent chain nests two expression levels per link (call → property access → receiver).
The parser's expression-tree cap was 32, so the seventeenth link and everything inside
it — including the `new S()` at the head — were never emitted, and the outer links
resolved to nothing because their receiver expression did not exist. `c16` is the
control (exactly at the old cap), `c17` one past it, `v20` a twenty-link chain whose
head is a separate statement. Every link must resolve to `S.a`, and every `new` must be
a `known_edge` to the constructor.
