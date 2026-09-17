# C# schema — the constraints it will be judged against

Recorded before the draft exists, because a resolved-link column is cheap to add and
expensive to remove: TypeScript wrote cross-file import following, extends-chain walking
and multi-hop property resolution, then deleted all three and kept same-file one-hop links.

This binds `src/schema/csharp/`, and `cs-fixtures` and `cs-impl` should read it before
writing anything.

---

## 1. The rule

**The parser emits IR. The engine resolves.**

Java is the proof, not the analogy: `referencedTypeRegistryLinkHash` is populated **0 times
out of 67,938 rows**, and no code path would ever fill it. That is the design, not an
oversight.

**The metric is IR completeness, not resolution rate.** For every call site: is every hop an
engine would need actually present? A receiver whose type lives in another file needs three
things and only three —

1. the declared type **name as written**,
2. the **importing module**,
3. `import.resolvedFilePath`.

Present, and the row is **complete** even though the parser resolved nothing.

### What this forbids in `cs_*`

- No extends-chain walking. No cross-file base-type link.
- No multi-hop property resolution.
- No cross-file `using` following.
- **No resolved-link column justified by "the oracle could fill it."** The oracle's ability
  to adjudicate is a fact about the oracle, never a licence to emit.
- Same-file, one-hop links only.

### The oracle answers oracle questions

`GetSymbolInfo`, `GetTypeInfo`, `ClassifyConversion`, `ReducedFrom`, `LookupSymbols`,
`DeclaringSyntaxReferences` decide **whether an expectation can be adjudicated**. None of
them is a column. `CandidateReason` classifies *why* adjudication failed — parser wrong vs
code does not compile vs checkout incomplete — and is likewise not emitted.

---

## 2. LINQ — ruled. Synthesis withdrawn.

**Query clauses get a wrapper node, children parented to it, clause kind in a column.**
The engine desugars.

This is §3's rule unchanged — the same shape as `x += 1`: one wrapper, parented children,
the variant in a field rather than multiplied into kinds.

The reason the other option is not merely worse but wrong: `from`/`where`/`select` is
**structure the parser can see**. `Where()`/`Select()` is a **resolution outcome it cannot** —
which overloads, on which receiver type, through which extension method in which `using`
scope. Synthesising those calls would be the parser inventing edges, and §3 is explicit that
inventing value flow is worse than dropping rows.

The grammar already gives the structure: `query_expression` with `from_clause`,
`where_clause`, `select_clause`, `group_clause`, `join_clause`, `order_by_clause`,
`let_clause` as children. Verified parsing on the fork.

> **Live inconsistency to fix outside my boundary.** `BUILDING-CSHARP.md:150-152` still
> reads *"Decide explicitly: synthesize the calls with a flag … or emit query clauses …
> Either is defensible."* That is the withdrawn menu, and it is the document `cs-fixtures`
> and `cs-impl` will read. It lives in `.claude/`, which I do not own. **Handing it over.**

---

## 3. The §2 constructs, restated IR-shaped

Each of these has a tempting resolution-shaped version. The IR-shaped one is binding.

| construct | the parser emits | the parser does **not** |
|---|---|---|
| **extension methods** | the `this`-parameter marker, the declaring static class, and the governing `using` set — three facts as written | decide visibility, or bind `xs.Count()` to a declaration |
| **partial types** | a primary key under which N declarations are one entity | resolve across files beyond what the key states; `DeclaringSyntaxReferences` is the **oracle's** check |
| **`#if`** | which rows exist, per target framework (option 3) | link anything |
| **explicit interface impl** | the interface name **as written**, and that the member has no accessible name on the type | resolve the interface |
| **operators / conversions** | that a conversion operator is declared here | mark a cast as a call edge — the engine makes that edge |
| **delegates / method groups** | the method-group reference as written; `methodReferenceKind` filled **from syntax** | bind the group to a target |
| **events, `+=`** | a wrapper node with subscription kind in a column | resolve the handler |
| **`out`/`ref`/`in`/`params`** | the mode, as a column on the parameter row | model the second return channel's dataflow |
| **`dynamic`** | **reserved** — a call syntax cannot decide | guess |

---

## 4. What this means for numbers already reported

- **99.63% declaration recovery** is an IR-completeness-shaped number — *are the rows
  there* — measured against Roslyn as an oracle. It is not a resolution rate and must not be
  quoted as one.
- The **injectivity allowlist** is about node **kinds**, not links. Unaffected.
- The **`#if` option-3** recommendation is about *which rows exist*. Unaffected.

Nothing in the three Phase 0 memos proposes a resolved-link column; I checked before writing
this. The LINQ menu was never ruled on in them either — it lives only in the brief.

---

## 5. Handover

1. **`BUILDING-CSHARP.md:150-152`** carries the withdrawn LINQ menu. Outside my directory.
2. **The JavaScript memo** at `js-oracle` `5273e10` was written by me earlier in this
   session and headlines *"WHAT IS THE RESOLUTION CEILING?"*. The number is sound — it sizes
   whether the **oracle** can adjudicate — but the framing is exactly what invites a
   resolved-link column, and its §2 should say so explicitly. `js-oracle`'s to make; I am
   not editing another agent's directory. The CommonJS point belongs there too:
   `require('./x')` is a module edge **recorded as written**, with the specifier and
   whatever the module graph already gives — never a followed one.
