# Audit — round 2, after the field work (A3 @ `05bf1da`)

Six new commits since the last audit: `py_field` un-deferred, inference folded
into `py_expression`, ATTRIBUTE and CALL_RESULT call resolution, module/import
resolution. Re-run of every lens, plus a new one for the new relation.

## Fixed since the last audit

| | |
|---|---|
| `py_field` / `py_field_position` | **now emitted** — 19 rows on the audit fixture, 2,683 on 400 stdlib files |
| Enum members | **now present**, with values: `Color.RED` → `fieldOrigin=ENUM_MEMBER`, `fieldModifier=CLASS_VAR,ENUM_MEMBER,READ_ONLY`, `initializerText='1'` |
| `__slots__`, dataclass fields, `ClassVar` | all recognised: `SLOTS_ENTRY`, `DATACLASS_FIELD`, `CLASSVAR_ANNOTATED` |
| `py_field_write` | **not a gap** — the schema §2.10 now says REMOVED, redundant with `py_expression`. Withdrawing that part of a4-045. |
| a4-034 (lambda `py_method` rows), a4-037 (comments as bases) | verified fixed, no regression |

No regressions: Gate 1 on the same 400 files is byte-identical (0/0/0/0/0,
348 `.0`), `py_method`/`py_method_parameter` 0 diffs, `py_type`/`py_type_base`
0 diffs.

## New lens: `py_field` vs `ast`

Compares the **set of field names per class** — not `fieldOrigin` or
`fieldModifier`, which are derived classifications ast cannot adjudicate.

Calibrating the oracle took four passes, and each pass was a bug in *A4's*
mapping, not the parser's — worth recording, because each one initially looked
like a parser defect:

1. **private name mangling** — the parser emits `_Printer__data`, which is what
   CPython actually creates and what symtable reports; the source spelling
   `__data` is the wrong expectation.
2. **nested unpacking targets** — `self._reader, self._writer = pipe()` is a
   Tuple of Attributes.
3. **conditional class bodies** — `if sys.platform == ...:` at class level still
   declares class attributes.
4. **nested classes** — `self.x` inside a class defined *inside a method*
   belongs to the inner class; `self` rebinds.

After all four: **0 spurious, 7 missing across 400 stdlib files**, and all seven
are one bug.

### The one real py_field coverage defect

`class C: a = b = c = 1` emits **only `a`**. Chained class-body assignment keeps
just the first target. The `self.` form is correct — `self.p = self.q = 3`
yields both — so it is specific to the class body.

Real occurrences in the slice: `distutils/unixccompiler.py:80`
(`static_lib_format = shared_lib_format = dylib_lib_format = "lib%s%s"`),
`email/_header_value_parser.py:491`, `collections/__init__.py:215`
(`update = __update = MutableMapping.update`), and three more distutils
compilers. Reduction: `reductions/red_field_chained_class_assignment.py`.

### Two consistency defects inside py_field

- **A repeated value in a comma-set**: `Point.tags` gets
  `CLASS_VAR,DATACLASS_FIELD,DATACLASS_FIELD,READ_ONLY` for a
  `field(default_factory=list)` declaration.
- **Per-origin rows contradict each other.** The PK is
  `(pyTypeLinkHash, name, fieldOrigin)`, so two rows for one field are *by
  design* — but the derived columns are computed per row, not per field, so
  `Account.balance` is described twice and inconsistently:

  ```
  SLOTS_ENTRY  writeCount=1  READ_ONLY present
  SELF_ASSIGN  writeCount=2  READ_ONLY absent
  ```

  54 such contradictions in the 400-file slice. A consumer asking "is this field
  read-only" gets both answers.

## Call-site resolution — and a correction to my own earlier number

My previous 43.4% / 19.8% came from a **flattened** directory of 400 unrelated
stdlib modules copied under md5 filenames. In that shape `importsResolved` is
literally 0, because no module name matches a path — so it under-measures
resolution badly. Measured on *project-shaped* code instead:

| corpus | sites | kind-resolved | **hash-resolved** |
|---|---|---|---|
| flattened 400 files (my artifact) | 26,391 | 47.5% | 20.0% |
| real stdlib packages (asyncio, email, json) | 5,661 | 49.2% | **28.4%** |
| `test-data/python/linkage-sample` | 49 | — | **79.6%** |

By receiver, on the real packages:

```
SELF          665 sites   622 hash-resolved (93.5%)
SUPER          97          65               (67.0%)
NONE         1734         537               (31.0%)
NAME         2108         343               (16.3%)
CALL_RESULT    75           4                (5.3%)
ATTRIBUTE     756          32                (4.2%)
LITERAL/SUBSCRIPT 217        0                (0.0%)
```

So the honest reading: **within-object calls are nearly solved** (SELF 93.5%),
and the remaining gap is exactly where the human placed it — ATTRIBUTE chains,
now 42.5% *classified* but only 4.2% *linked to a callee*. Classifying the
receiver and resolving it are two different milestones, and only the second
produces a call-graph edge.

## Still missing

**Relations (7 of 20 live):** `py_decorator`, `py_decorator_argument`,
`py_comment`, `py_block`, `py_type_parameter` (3.12, out of target),
`py_parse_gap` (deliberate — the skipped-files CSV carries it), and
`py_type_inference` (folded into `py_expression`, per `795b7a3` — confirm this
is a schema amendment, not an omission).

**Columns empty with the construct present** — re-verified at this head:

| column | evidence |
|---|---|
| `py_binding.targetEntityKind` / `targetEntityHash` | 0 of 6,578 — still `NONE` for every `def`/`class` name |
| `py_expression.returnStatementIndex` | 0 of 508 `RETURN_VALUE` rows |
| `py_expression.potentialQualifiedName` | 0 of 28,402 |
| `py_module.futureImports` | probe file opens with `from __future__ import annotations` |
| `py_type_base.pyExpressionLinkHash` | 0 of 99 |
| `py_type_reference.pyExpressionLinkHash` | 0 of 6,970 |
| **`py_field.pyExpressionLinkHash`** | **new** — 0 of 19 on a fixture with 5 self-writes (schema col 26: "first write's target node") |

Improved: `py_import.resolvedModuleLinkHash` was 0 of 2,352, now **252 of 669**
on fastapi.

Not bugs, verified populated when the construct exists: `fieldTypeName`,
`fieldBaseType` (6 of 19 on the fixture; asyncio has literally zero annotated
attributes), `bindingLinkHash` (14 of 19 — exactly the non-`self` rows, as the
schema specifies), `declaringMethodLinkHash` (3 of 19 — exactly the
`SELF_ASSIGN` rows).

---

## Follow-up: does `py_field` link back to `py_type_reference`, with nesting?

Asked of `Account.TABLE  fieldTypeName='ClassVar[str]'`. Measured on
`audit/audit_nested_type_references.py` and on pydantic (11,714 type references).

**Nesting: yes, and it is correct.** `ClassVar[Dict[str, List[int]]]`
decomposes into five rows with the parent/position chain intact:

```
d0 p0 SUBSCRIPT  ClassVar  ClassVar[Dict[str, List[int]]]  parent=-         context=VARIABLE_ANNOTATION
d1 p0 SUBSCRIPT  Dict      Dict[str, List[int]]            parent=ClassVar  context=GENERIC_ARGUMENT
d2 p0 NAME       str       str                             parent=Dict      context=GENERIC_ARGUMENT
d2 p1 SUBSCRIPT  List      List[int]                       parent=Dict      context=GENERIC_ARGUMENT
d3 p0 NAME       int       int                             parent=List      context=GENERIC_ARGUMENT
```

`Optional[str]` sets `isOptional`, `"Account"` sets `isStringForwardRef` and
resolves, `int | None` is `UNION_PEP604` with both arms parented correctly.

**Linking back to the field: no.** Three separate facts:

1. `py_field` has **no `pyTypeReferenceLinkHash` column** — 29 columns, none of
   them a type-reference FK.
2. `referenceOwnerKind=FIELD` is **never emitted**: 0 of 11,714 rows on
   pydantic, 0 of 63 on the fixture. `context=FIELD_TYPE` likewise 0. Both enum
   values exist in the schema (§2.6 cols 1 and 16) and nothing produces them.
3. The references for a class-body field hang off its **binding** instead, with
   `context=VARIABLE_ANNOTATION`.

So the only path from a field to its decomposed type is a two-hop join:

```
py_field.bindingLinkHash → py_binding → py_type_reference
                                        WHERE typeReferenceOwnerHash = that binding
```

**And that path is broken exactly where it matters.** `bindingLinkHash` is `""`
for `self.*` fields — by design, schema col 25, *"no binding exists, which is
precisely the modelling problem"*. On pydantic, **68 of 625 annotated fields**
are `SELF_ASSIGN` and therefore have no route to their type references at all:
`self._config_wrapper_stack: list[ConfigWrapper]` keeps `list[ConfigWrapper]`
only as a **string** in `fieldTypeName`, with the decomposed `ConfigWrapper` row
unreachable from the field.

Two smaller observations from the same probe:

- **`Callable[[int, str], bool]` flattens.** `int`, `str` and `bool` all land at
  depth 1, positions 0/1/2, with nothing marking which are parameters and which
  is the return. The written nesting has the argument list one level deeper.
- **`referencedTypeLinkHash` resolves 7.9%** (928 of 11,714 on pydantic). So even
  where the rows are reachable, they mostly name a type rather than point at one.
