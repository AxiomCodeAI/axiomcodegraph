# Audit — what is emitted, what resolves, what is missing

Method: run the parser for real (`PythonProjectAnalyzer` at the last pushed
commit, `48755be`), then interrogate **only the CSVs**, the way a consumer
would. Three corpora: the `linkage-sample` test program, an A4 audit fixture
covering locals/fields/enums (`audit/audit_locals_fields_enums.py`), 400 real
CPython 3.10.4 stdlib files, and fastapi.

## 1. Relations: 11 of 21 emitted

| Emitted (11) | Not emitted (10) |
|---|---|
| `py_module`, `py_scope`, `py_binding`, `py_type`, `py_type_base`, `py_method`, `py_method_parameter`, `py_import`, `py_expression`, `py_call_site` — the frozen spine — plus `py_type_reference` | `py_field`, `py_field_write`, `py_field_position`, `py_decorator`, `py_decorator_argument`, `py_comment`, `py_block`, `py_type_inference`, `py_parse_gap`, `py_type_parameter` |

`py_parse_gap` is deliberate (the analyzer records rejections in
`skipped-python-files.csv` instead) and `py_type_parameter` is 3.12, out of
target. The other eight are the deferred set.

## 2. The three the human named

### Local variables — PRESENT, and correct

Verified on the audit fixture: 17 bindings link to method `compute` through
`pyMethodLinkHash`, with the origin distinguishing every binding form —

```
acc     kind=LOCAL  origin=ASSIGNMENT       err    kind=LOCAL origin=EXCEPT_TARGET
items   kind=LOCAL  origin=ASSIGNMENT       handle kind=LOCAL origin=WITH_TARGET
index   kind=LOCAL  origin=FOR_TARGET       label  kind=LOCAL origin=MULTIPLE (assigned then del)
factor  kind=PARAMETER origin=PARAMETER     enumerate kind=GLOBAL_IMPLICIT
```

`py_binding` **is** the `java_local_variable` analogue and it works. The gap is
narrow: `declaredTypeName` is populated only for *annotated* locals (505 of
6,578 bindings in fastapi). An unannotated local carries no type, and
`py_type_inference` — the relation that would supply one — is not emitted.

### Fields — ABSENT as a relation, but the raw material is already there

`py_field` / `py_field_write` / `py_field_position`: **no such files**. What
exists today, and what a `py_field` builder could join from:

| what | where it already is |
|---|---|
| class-body fields | `py_binding` in a `CLASS` scope, with `bindingOrigin` = `ASSIGNMENT` / `ANNOTATED_ASSIGNMENT` / `ANNOTATION_ONLY`, and `declaredTypeName` when annotated (`Account.TABLE` → `ClassVar[str]`, `Point.x` → `int`) |
| instance fields | `py_expression` `ATTRIBUTE_ACCESS` rows with `isWrite=true`, `dottedPath='self.balance'`, `nameContext=STORE`, **and `pyTypeLinkHash` already pointing at the owning class** |
| `__slots__` | a single `py_binding` for the name; the entries are a tuple literal, not per-field rows |
| dataclass fields | class-body annotated bindings; `field(default_factory=list)` is a `CALL` expression |

So `Account.owner`, `.balance`, `._audit` are recoverable (1, 2 and 1 writes
respectively) — but nothing says *"class Account declares balance"*, so there
is no place to hang an attribute type, which is what data-flow path ③ needs.

### Enums — ABSENT, and they ride on the same missing relation

The schema settles this explicitly (§6, `java_enum_constant` row): *"No separate
relation. Python `Enum` members are class-body assignments: `py_field` with
`fieldModifier` containing `ENUM_MEMBER`, in a `py_type` with
`typeCategory=ENUM_CLASS_TYPE`."*

The type half works — `Color`, `Flags`, `Mode` all come out as
`ENUM_CLASS_TYPE`. The member half has nowhere to go: `RED`, `GREEN`, `BLUE`
appear only as `CLASS_ATTRIBUTE` bindings, with **no marker that they are enum
members and no value** (`RED = 1` loses the `1`). One relation, `py_field`,
closes both this and the field gap.

## 3. Spine columns that are empty when the construct is present

Distinguishing "unimplemented" from "the corpus had none" needs the denominator,
so each was probed with a file that contains the construct:

| column | evidence |
|---|---|
| `py_binding.targetEntityKind` / `targetEntityHash` | `NONE`/empty on **all 6,578** fastapi bindings, including every `def`/`class` name. A binding never points at what it declares. |
| `py_expression.returnStatementIndex` | 508 rows with `edgeRole=RETURN_VALUE`, **0** populated |
| `py_expression.potentialQualifiedName` | 0 of 28,402 |
| `py_module.futureImports` | probe file starts `from __future__ import annotations`; column is `''` |
| `py_type_base.pyExpressionLinkHash` | 0 of 99 — the FK to the base expression node |
| `py_type_reference.pyExpressionLinkHash` | 0 of 6,970 |
| `py_import.resolvedModuleLinkHash` / `resolvedTargetHash` | 0 of 2,352 — this is why IMPORTED call sites have no callee |

Verified **not** broken (they populate when the construct exists):
`encodingDeclared`, `dunderAllNames`, `metaclassName`, `enclosingTypeLinkHash`,
`enclosingMethodLinkHash`, `typePlacement`, `parameterTypeName`,
`returnTypeName`, `declaredTypeName`. An earlier "100% empty" reading of
`parameterTypeName` was a corpus artifact — those 400 stdlib files contain 5
annotated parameters in 12,282.

## 4. Call-site resolution — 43.4% is right, but it is not an edge

Independently reproduced: `resolvedCalleeKind` is populated on
11,442 / 26,391 = **43.4%**. But the column that gives a call graph an edge is
`resolvedCalleeHash`, and that is on **5,215 / 26,391 = 19.8%**.

| resolvedCalleeKind | rows | with a callee hash |
|---|---|---|
| UNRESOLVED | 14,949 | 0 |
| BUILTIN | 4,144 | 0 |
| IMPORTED | 2,083 | **0** |
| METHOD | 2,725 | 2,725 |
| MODULE_FUNCTION | 1,540 | 1,540 |
| TYPE | 950 | 950 |

BUILTIN with no hash is honest — `len` has no `py_method` row in this corpus.
**IMPORTED with no hash is the cross-module edge**, 2,083 sites (7.9%), and it
is blocked on `py_import.resolvedModuleLinkHash` being empty rather than on
anything about receivers.

By receiver, the two numbers diverge most where it matters:

```
receiverKind     sites    kind-resolved    hash-resolved
NAME              7237       29.6%             0.8%
SELF              5231       48.9%            48.9%
ATTRIBUTE         2537        0.0%             0.0%
CALL_RESULT        261        0.0%             0.0%
```

NAME receivers get a kind on 29.6% of sites but an actual callee on 0.8%.

One correction to the framing: ATTRIBUTE is 9.6% of call sites in this slice and
5.1% in fastapi, not 18.8%. The slice is alphabetically-early stdlib and
excludes `test/`, so it is not a representative corpus for receiver mix — the
schema's 18.8% came from a different one. The conclusion is unchanged; the
denominator should just be quoted with its corpus.

## 5. What Gate 1 / Gate 2 do and do not cover on these 400 files

Reproduced with A4's independent mapping, not A3's harness:

- **Gate 1 confirmed.** 0 missing scopes, 0 spurious, 0 missing bindings, 0
  spurious, 0 predicate mismatches across 8,415 scopes and 48,130 bindings.
  Two caveats: 348 `.0` rows in 90 files (A4 deliberately does not whitelist
  them — finding a4-026), and this slice excludes `test/`, which is exactly
  where the full-stdlib sweep found the 10 files that *do* disagree
  (a4-027…a4-033).
- **Gate 2 confirmed** for `py_method`, `py_method_parameter`, `py_type` and
  `py_type_base` — 0 diffs, now including all 55 lambdas in the slice, so
  **a4-034 is fixed**. a4-037 (comments taking an MRO position) is fixed too.
