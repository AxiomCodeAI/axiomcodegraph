# The mapping — what is compared to what, and why it is trustworthy

A differential is only as good as its mapping. Three of A4's early "findings"
turned out to be mapping bugs (a4-025, a4-031, and a base-order sort artifact),
so the mapping is written down here, each rule with the reason it is safe, and
every lens carries a **negative control**: a deliberately corrupted oracle that
must make the lens fire. A lens that cannot fail is not evidence.

Ground truth is CPython 3.10.4 (`/Library/Frameworks/Python.framework/Versions/3.10`).
The parser is tested in a **detached worktree at the last pushed commit**, never
A3's working tree.

Run `reports/MAPPING-PROOF.txt` (regenerate with `tools/mapproof.ts <file.py>`)
to see every row of every relation printed beside the CPython value it is
compared to.

---

## 1. `py_scope` → `symtable` block

**Key** `(kind, name, startLine)`, compared as a **multiset** — two lambdas can
share a name and a line, so a set would silently merge them.

| ours | CPython | rule |
|---|---|---|
| `MODULE` | block type `module` | |
| `CLASS` | block type `class` | |
| `FUNCTION` | block type `function` | |
| `LAMBDA` | block type `function`, name `lambda` | |
| `COMPREHENSION_LIST/SET/DICT`, `GENERATOR_EXPRESSION` | block type `function`, name `listcomp`/`setcomp`/`dictcomp`/`genexpr` | **unsound by name alone** — see a4-031 |

**a4-031 (mapping hazard, not a parser bug).** symtable names a comprehension
block `listcomp`; a user function `def listcomp():` is indistinguishable from it
by name and type. `test/test_peepholer.py:484` does exactly that, and A4's
mapping mis-kinded four scopes and blamed the parser for one iteration. The
discriminator must come from `ast`, not from symtable. Any name-based mapping
has this hole, A0's included.

## 2. `py_binding` → `symtable.Symbol`

**Key** `(scopeKey, name)`. **Value**: all eleven predicates compared bitwise,
in this order:

```
is_parameter is_local is_global is_nonlocal is_free is_imported
is_assigned is_referenced is_declared_global is_annotated is_namespace
```

No predicate is excluded and no name is whitelisted — including `.0`, which is
compared like any other name precisely so that a4-026 shows up.

## 3. `py_method` / `py_method_parameter` → `ast`

**Key** `(startLine, startColumn)` of the `def`/`async def`/`lambda`.
`startColumn` is a UTF-8 byte offset on both sides since `fb7d4f0` (a4-019).

| ours | CPython |
|---|---|
| `POSITIONAL_ONLY` | `args.posonlyargs` |
| `POSITIONAL_OR_KEYWORD` | `args.args` |
| `VAR_POSITIONAL` | `args.vararg` |
| `KEYWORD_ONLY` | `args.kwonlyargs` |
| `VAR_KEYWORD` | `args.kwarg` |

**Excluded:** `POSITIONAL_ONLY_MARKER` and `KEYWORD_ONLY_MARKER` rows (the `/`
and `*` tokens). They are a parser modelling choice with no ast counterpart;
counting them would be scoring a decision, not a fact. `<module>` and
`<classbody>` synthetics are excluded from the spurious check for the same
reason.

## 4. `py_type` / `py_type_base` → `ast`

**Key** the class's `startLine`. `py_type` carries no `startColumn`, and two
class statements cannot begin on one line (a compound statement cannot follow a
`;`), so the line is unique for classes.

Bases are compared **in order**: positional rows sorted by `position`, then
keyword rows in emission order, which is the order `ast` lists them. Base text
is whitespace-normalised on both sides.

**Excluded:** `baseKind = IMPLICIT_OBJECT` (a4-038 — the parser models the
implicit `object` base on `py_type.mroKind` and emits no row, which agrees with
ast; the enum value is therefore unreachable).

**The sort artifact worth remembering:** schema col 1 says `position` is `""`
for keyword rows. `Number("") === 0`, so sorting keyword and positional rows
together interleaves them, and the lens reported a false ordering bug on
`class C(A, B, metaclass=M)` until the two were split.

**`typeCategory` is NOT compared.** It is a derived classification; `ast` cannot
adjudicate it. This lens checks only what ast can decide: which classes exist,
their names, and the order and text of their bases — which is the part that
carries the MRO.

## 5. Grammar-level lenses (tree-sitter vs `ast`, no parser involved)

Construct counts, node positions, scope-bearing node counts, and parse
failures. Two classes are permanently excluded, with reasons:

- **f-string interiors** (a4-020). Before 3.12 CPython synthesises positions
  inside an f-string — every node in one interpolation reports the same
  `col_offset`. tree-sitter reports the real column. The oracle cannot
  adjudicate here, so `ast_positions.py` marks those nodes and the comparison
  skips them.
- **match patterns** (a4-009). A dotted value pattern is `dotted_name` in the
  tree and `Attribute` in ast — a filed modelling divergence, so pattern nodes
  are bucketed rather than counted as new findings.

---

## Negative controls — proof each lens can fail

| Lens | Control | Result |
|---|---|---|
| `py_type_base` order | reverse the base list in the oracle | 161 of 399 stdlib files fire (vs 0 unmodified) |
| `py_method`/params | lambdas, which the parser omits | 15,725 `METHOD MISSING` across the corpus |
| `py_binding` | `.0`, deliberately not whitelisted | 2,455 rows fire on the stdlib |
| construct counts | 64-file probe set of known-good source | mapping calibrated until only real findings remain |
| positions | same probe set | 3 mapping bugs found and fixed before trusting the residual |
