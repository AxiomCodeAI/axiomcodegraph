# TypeScript engine regression suite

Sixteen hand-written cases, each solved TWICE and scored against the TypeScript
compiler. `./run-tests.sh --oracle` is the whole thing.

## What a case is

```
cases/<NN-name>/
  src/     the client — parsed to IR and analysed
  lib/     the case's own "library" — parsed SEPARATELY into its own IR and handed
           to the engine with --library, exactly as a real dependency is
```

The client imports from `../lib/…`. Nothing in `lib/` is ever in the client's IR, so a
client→library edge can only exist if the module graph actually crossed the boundary.

## Why every case is solved twice

```
pass 1   --library <empty dir>   ->  expected/<name>.edges
pass 2   --library <the lib IR>  ->  expected/<name>.lib.edges
```

The delta between the two goldens **is** the client→library mapping. A single run
cannot separate "resolved correctly" from "resolved by accident": if the library link
were spurious, removing the library IR would move the CLIENT edges too. Pinning both
turns that into a reviewable diff on every change instead of a claim. On the corpus this
same A/B showed client-side accuracy moving by 0.000 on two projects out of three when
the libraries were removed — which is the evidence that the boundary is real.

## The four things that can fail

1. **COVERAGE GUARD** — every row of `all-typescript-call-sites.csv` must appear as the
   FromExpr of some edge, resolved or explicitly unresolved. A site that appears nowhere
   was dropped silently, and you cannot notice an absence you never recorded. This runs
   on both passes.
2. **EDGE GOLDEN** — the normalized edges, per call SITE. The line number is part of the
   key on purpose: deduplicating on (caller, target) merges every call to an overloaded
   function from one caller into one row, which is exactly how three `format(...)` calls
   resolving to the wrong first overload once looked identical to one correct call.
3. **ORACLE** — `checker.getResolvedSignature` for every call, from a real `ts.Program`
   over the case. MISSING is a defect; EXTRA is sound over-approximation and is pinned
   too, so a rule that widens the dispatch set shows up rather than hiding behind
   "extras are expected". The oracle refuses to answer for a case that does not
   typecheck, because the checker would then be answering about a program nobody wrote.
4. **KNOWN-MISSING** — `expected/<name>.known-missing` and `<name>.lib.known-missing`
   list accepted gaps. A NEW missing edge fails. A listed gap that STARTS working also
   fails, so the debt list cannot rot.

`--bless` regenerates the goldens but CANNOT bless away an oracle failure: a new missing
edge fails the run whether or not the golden was rewritten.

## What the cases cover

| case | mechanism |
|---|---|
| 01 | class dispatch, `super`, abstract members, statics, monomorphic `const` receivers |
| 02 | interface fan-out; nominal implementors; a never-constructed implementor (CHA ∖ RTA) |
| 03 | structural satisfaction — a class satisfying an interface with no `implements` |
| 04 | overload selection: function, method, and static, each choosing a non-first signature |
| 05 | declaration merging: interface+interface, function+namespace |
| 06 | re-export chains: named, aliased, star, type-only, and a two-hop barrel |
| 07 | namespaces, nested namespaces, `export =`, `import =` |
| 08 | function values, callbacks, a readonly function field, a bound method |
| 09 | generic substitution from the receiver, and inference from an argument |
| 10 | JSX component invocation — self-closing, with children, and from a library |
| 11 | `await`, awaited member access, and three call sites sharing one line |
| 12 | accessors, static factories, enum members |
| 13 | every receiver form: property, call return, element access, `?.`, `!`, `as`, `new` |
| 14 | same class and function names in three modules — only the module distinguishes them |
| 15 | `import type` must contribute no runtime edge; the value import beside it must |
| 16 | self-recursion, mutual recursion, and recursion inside the library |

## Deliberately client-only in pass 1

Pass 1 stages no library IR at all — not the standard library, not `@types`. A call into
a library therefore resolves to nothing and is recorded as a declared unknown, which is
the honest answer for a client-only analysis. That keeps the suite runnable by anyone
who clones the repo: no 2 GB of library IR, no `npm install`.

## Environment

`AXIOM_PARSER` — path to the parser entrypoint (default `../../../Parser/dist/index.js`).
