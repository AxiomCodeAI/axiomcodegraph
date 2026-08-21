# Stopping condition — proposed replacement wording

**Author:** A0. **Status:** proposed wording for the human to place in `README.md`.
**I have not edited the README** — it is not mine to write.

Replaces: *"two consecutive full corpus sweeps producing zero new disagreements, at the
coverage bar the human sets."*

## Why the current condition fails

It measures **corpus churn, not correctness**. Once mining plateaus it passes automatically,
whether or not the parser is right. Measured saturation over 917 files from six major
projects (SQLAlchemy, Scrapy, IPython, `_pytest`, botocore, tornado):

```
  1 file  :  65.0% of reachable node types
 25 files :  77.2%
100 files :  82.1%
500 files :  85.4%
917 files :  86.2%     <- 417 further files bought ONE node type
```

So the problem is not that the bar is easy. It is that mining reaches ~86% almost
immediately and **then cannot finish at all** — the tail is unreachable by mining and needs
authored fixtures. A gate that saturates stops discriminating while still reporting green.

Separately, the **129 bar is unreachable as stated**: 6 of the 129 named types are
*supertypes* (abstract; they never appear in a concrete tree).

## The three gates

Distinguishing *is the parser correct* from *is the corpus adequate* — the old condition
conflated them.

---

### Gate 1 — EXACT. Adjudicated by CPython `symtable`.

`py_scope` and `py_binding` **set-equality at 100%** over the named corpus, per Appendix B
invariant #9: every scope, every `(scope, name)` pair, and all **11** `Symbol` predicates.

This is the only gate backed by genuine external ground truth. CPython computes the answer
by a different algorithm, in a different language, written by people with no knowledge of
this parser. Disagreement here means **we are wrong**, not that adjudication is needed.

**`.0` is a positive assertion, not a whitelist.** A whitelist says "ignore if present",
which also passes when the binding is *missing*. The assertion is:

> On an `emissionRegime=PY3_0_11` target, **every** `COMPREHENSION_LIST` / `_SET` / `_DICT`
> and `GENERATOR_EXPRESSION` scope contains **exactly one** binding named `.0`. On
> `PY3_12_PLUS`, only `GENERATOR_EXPRESSION` scopes do, and comprehension scopes must be
> **absent entirely**.

Stated that way it is a test of the emission rule (§4.4), and it fails loudly if `.0` is
dropped — which a whitelist would have hidden.

**Covers 3 of 10 frozen spine relations** — `py_scope`, `py_binding`, and `py_method_parameter`
(parameter *names*, adjudicated exactly by `symtable.Function.get_parameters()`).

---

### Gate 2 — CROSS-CHECK. A second implementation, *which I also author*.

The remaining spine relations compared against a CPython `ast`-derived extraction.

**This is a materially weaker guarantee than Gate 1 and must not be reported alongside it as
if equivalent.** `symtable` is independent ground truth; the `ast` extraction is a second
implementation by the same author, from the same understanding, against the same schema. Two
implementations sharing an author share its blind spots — a mistaken reading of, say,
decorator application order would be encoded identically in both and agree perfectly.

> **What Gate 2 establishes: that two independent traversals disagree, and where.**
> **What it does not establish: that either is correct.** A Gate 2 disagreement opens an
> adjudication — a human, or the language reference — decides which side is wrong. Gate 2
> passing means *no disagreement was surfaced*, which is evidence, not proof.

Covers: `py_expression` (tree shape, `nameContext`, **edge roles**), `py_method`,
`py_method_parameter` (posonly/args/vararg/kwonly/defaults/annotations via `ast.arguments`), `py_type`, `py_type_base` (**ordering**, which C3 depends on),
`py_import`, `py_call_site` (caller attribution, arg counts, keyword names).

**Covers 7 of 10 frozen spine relations.**

---

### Gate 3 — CORPUS ADEQUACY. Not a parser-quality measure.

Node-type coverage, reframed: it gates whether we are *entitled to trust* Gates 1–2, since a
gate is only as good as the inputs exercising it.

**Bar: 115 / 115.** Derivation from the pinned `tree-sitter-python@0.21.0`:

| | count |
|---|---|
| named node types (the old README bar) | 129 |
| − 6 supertypes (abstract, never in a concrete tree) | 123 |
| − 3 Python 2 (`print_statement`, `exec_statement`, `chevron`) — must **never** appear; §6.2 rejects those files | 120 |
| − 3 rejected by 3.10.4: `type_alias_statement`, `constrained_type`, `splat_type` (verified against the 3.10.4 interpreter — PEP 646 `tuple[*Ts]` is 3.11 and `Callable[**P, int]` is not valid syntax at all) | 117 |
| − 1 `member_type` — **unreachable**: no probe produces it, including PEP 695 `type` contexts and every dotted-annotation form | 116 |
| − 1 `except_group_clause` (`except*`, 3.11 — above target) | **115** |

*Not* deducted: `type_parameter`. `class C[T]` is 3.12, but the same node is produced by
`x: list[int]` which 3.10.4 accepts — and it is already in the seen set.

Mining reached **105/115**. The gap is **10**, and it is a
**blocking prerequisite on A1/A2** — no amount of further mining closes it:

- **9 `match`-statement types** (PEP 634): `match_statement`, `case_clause`, `case_pattern`,
  `class_pattern`, `complex_pattern`, `dict_pattern`, `keyword_pattern`, `splat_pattern`,
  `union_pattern`. Legal on 3.10.4; absent because these libraries target ≤3.9.
- **`parenthesized_list_splat`**.

**Gate 3 is not met and cannot be met until those 10 fixtures land.**

---

## Spine relations no gate covers

Gates 1+2 cover 9 of 10.

**`py_module` — ungated, and recorded as DELIBERATE.** It carries no data-flow path; it is
the key-chaining root, and referential integrity (#1), no-PK-collision (#2), determinism (#5)
and interpreter pinning (#10) already cover what can go wrong with it.

- *Unavoidable:* `filePath`, `baseMservPath`, `serviceVersionLinkHash`, `targetVersion`,
  `emissionRegime`, `moduleKind`, `isExternal` are **harness-supplied provenance**. No oracle
  can adjudicate them because CPython has no opinion about them; they are facts about the
  analysis run, not about the source. Their correctness is enforced by Appendix B invariants
  #4, #10 and #11 instead, which is the right instrument.
- *Deliberate, and now corrected:* its **content** columns — `hasDunderAll`,
  `dunderAllIsStatic`, `dunderAllNames`, `hasModuleDocstring`, `futureImports`,
  `qualifiedName` — *are* ast-derivable and materially load-bearing (Q9's re-export
  resolution depends on `__all__`). They are hereby **in Gate 2**.

**`py_method_parameter` is now in BOTH gates.** It is the target of argument→parameter flow,
the primary typing mechanism given 68.2% unannotated parameters, and it is gateable at both
levels: `symtable.Function.get_parameters()` adjudicates parameter *names* exactly (Gate 1),
and `ast.arguments` gives posonly/args/vararg/kwonly/defaults/annotations (Gate 2). Leaving
it ungated was an oversight, not a decision.

**Why Gate 2 is load-bearing and not decorative.** Gate 1 is structurally blind to data-flow
*direction*. `sink(taint(x))` and `taint(sink(x))` have identical bindings in identical
scopes, so Gate 1 reports 100% on both; if `edgeRole` mislabels argument vs receiver
position, or the parent link between nested calls collapses, the taint path inverts and the
engine reports flow into a sink it never reached. Same shape for the other two data-flow
carriers: `py_type_base` ordering wrong → MRO picks the wrong method, bindings unaffected;
`py_call_site` caller mis-attributed → the call-graph edge points at the wrong function,
bindings unaffected. Gate 2 is the *only* thing looking at any of this — which is exactly why
its cross-check-not-oracle label matters.

*Known-hazard check against the frozen PK:* nested calls sharing a start offset
(`super().set_exception(e)` — outer and inner `call` both start at index 0) remain distinct,
because `PY_EXPRESSION_md5` keys on `parentExpressionHash`, `edgeRole`, `depth` and
`endColumn` as well as start position. Worth an explicit regression fixture.

---

## Proposed README wording

> **Stopping condition.** Three gates, all required.
>
> 1. **Exact** — `py_scope` and `py_binding` set-equal CPython `symtable` at 100% over the
>    corpus, all 11 `Symbol` predicates, with `.0` asserted positively per the §4.4 emission
>    rule. Adjudicated by CPython; a failure means the parser is wrong.
> 2. **Cross-check** — the remaining spine relations agree with an independent `ast`-derived
>    traversal. This is a second implementation by the same author, so it detects
>    *disagreement requiring adjudication*, not correctness. Report it separately from Gate 1
>    and never aggregate the two into one number.
> 3. **Corpus adequacy** — 115/115 reachable node types for a 3.10.4 target. Currently
>    105/115; the remaining 10 (9 `match`, `parenthesized_list_splat`) are a blocking fixture
>    prerequisite on A1/A2 and are unreachable by mining.
>
> Plus the Appendix B invariants — referential integrity, no PK collisions, byte-identical
> output — which are independent of all three.
>
> "Two consecutive sweeps with zero new disagreements" is **retired**: it measures corpus
> churn, and mining saturates at 86% of node types after ~500 files.
