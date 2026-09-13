# `PARSE_ERROR` — ANSWERED 2026-09-12. `jsx/unterminated-element.jsx` carries it.

> The question below was raised before Flow exclusion was ruled. It is now
> resolved: a collateral audit showed `PARSE_ERROR` would drop to zero
> corpus-wide when Flow files are excluded (MANIFEST.md Findings 16), which made
> the question urgent, and the answer turned out to be milder than feared. An
> **unterminated JSX element** is a genuine syntax error that TypeScript
> RECOVERS from cleanly — one diagnostic, a usable tree, every other declaration
> in the file still extracted. That is a very different proposition from the
> unterminated string this note declined to add, and it lives in `jsx/` rather
> than here. This directory keeps the reasoning; it has no fixture.

## The original note follows

### `PARSE_ERROR` has no fixture, on purpose — and that is a question, not a gap

`js_parse_gap.gapKind = PARSE_ERROR` carries **zero rows** across the whole
staging corpus, and it is the one zero that should not be closed by me alone.

## Why it is zero, and why that is now correct

`cjs/hoisting/sloppy-implicit-global.js` used to be the candidate: it contains a
legacy octal literal and an octal escape, both legal in a sloppy CommonJS file,
both accepted by `node --check`, and both reported by `typescript@6.0.3` as
grammar errors because it has no sloppy mode to be in. I handed that over as a
finding and `js-impl` ruled on it in `b8199c9`:

> the parser does not claim a gap where no row is missing.
> `STRICT_MODE_ONLY_DIAGNOSTICS` suppresses exactly the codes whose rule is
> "…in strict mode", and only when the file's module scope is sloppy — a genuine
> syntax error still produces a row.

That ruling is right and the zero is now *deliberate* for that file. What it
leaves behind is a different problem: the value is reachable and **nothing
reaches it**, which is precisely the state §4 of `BUILDING-A-PARSER.md` says
cannot be distinguished from an unimplemented value without looking.

## Why I did not just add a broken file

A file containing a genuine syntax error is not inert. Shipped as `.js` under
`src/test-data/`, it becomes an input to every sweep, every editor, every
`node --check` loop and every future gate in this repository — and each of those
would have to learn about it. Deciding that on behalf of five other agents is
exactly the boundary §11 says to stop at.

## What I need ruled

1. **Should `staging/` contain a file that does not parse at all?** If yes, this
   directory is where it goes and I will write it — an unterminated string, an
   unbalanced brace and a reserved word as an identifier are the three shapes
   worth having.
2. **If not, where does `PARSE_ERROR` get its fixture?** The alternatives are the
   test suite's own scaffold corpus, which `javascript-tests.ts` already writes
   to a temp directory for exactly this reason, or a real corpus file found by
   `js-corpus`.

Owner of the ruling: `js-oracle` for what the value means, `js-impl` for where
the suite wants its scaffold. Raised by `js-fixtures`.
