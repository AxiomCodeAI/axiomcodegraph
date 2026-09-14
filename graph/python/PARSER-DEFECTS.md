# Parser defects found by the Python rule set

**STATUS after `Parser@7eb2deb` (`main`).** All twelve are closed except PD-4, which is open
by design: seven fixed, four retracted as artifacts of a STALE CHECKED-IN IR, one rejected on
better design grounds. PD-12, opened by the fix to PD-11's neighbour, was fixed in
`Parser@027c9a0` (PR #8).

Updated by the PARSER author, and every status below is stated against a measurement made at
`Parser@7eb2deb`, not read off a commit message. Where a claim in the original filing turned
out to be wrong, the filing text is left standing and the correction is stated next to it.

Re-measured by building the parser at `7ed5111` and at `main` into two trees and running
BOTH through the engine on `test/python/projects/two-service-fastapi`. The engine outputs are
identical except where noted below, which is the only way to tell a parser change that helps
from one that merely moves rows.

| # | construct | status |
|---|---|---|
| PD-1 | `py_binding.targetEntityKind/Hash` empty | **RETRACTED** — stale IR. Fresh parse: 464 of 767 rows populated (203 PARAMETER, 122 IMPORT, 107 METHOD, 32 TYPE). |
| PD-2 | no `ASSIGNMENT` node | **RETRACTED** — stale IR. Fresh parse of a 19-file project: 78 ASSIGNMENT nodes. |
| PD-3 | `all-python-decorators.csv` absent | **RETRACTED** — stale IR. Fresh parse: present, 17 rows, matching the source exactly. |
| PD-4 | `MISPARSED_SILENTLY` on `type(x).a = v` | **OPEN BY DESIGN** — grammar-level. tree-sitter DELETES the call node, so there is nothing to mint a call site from; the parser recovers everything else and records the rest as a `py_parse_gap`. 2 occurrences in the whole stdlib. Only the disposition NAME is a fair criticism. |
| PD-5 | builtins get `GLOBAL_IMPLICIT`, never `BUILTIN` | **FIXED** — `bindingKind=BUILTIN` now emitted, name list generated from the pinned interpreter, shadowing respected. |
| PD-6 | `py_field.pyExpressionLinkHash` empty | **RETRACTED** — stale IR. Fresh parse: 29 of 29 populated. |
| PD-7 | `py_type_base` / `py_type_reference` `pyExpressionLinkHash` empty | **HALF FIXED, HALF REJECTED ON BETTER GROUNDS.** `py_type_reference.pyExpressionLinkHash` is now filled (joined on byte range). `py_type_base` deliberately does NOT get one: it already carries `pyTypeReferenceLinkHash` on every row, so it reaches its expression THROUGH the reference, and a second direct edge could disagree with the first. The engine now uses the sanctioned path (`resolution/generics.dl` `type_base_ref`). |
| PD-8 | `from . import models` — `isModuleImport=false` | **FIXED** — widened at resolution, the first point that can know. The report ALSO called the empty `resolvedTargetHash` a defect; that was wrong, and the author is right: §2.9 makes it an FK to py_type/py_method/py_binding, and a module has its own `resolvedModuleLinkHash`, populated all along. **Retracted.** |
| PD-9 | `TABLE["k"](x)` is `DYNAMIC_CALL`, not `SUBSCRIPT_CALL` | **FIXED** — now `SUBSCRIPT_CALL` with `receiverText=TABLE`. |
| PD-10 | `class C(Base, metaclass=M)` emits two BASE_CLASS expressions at one position | **FIXED** — the value is enqueued directly; the keyword name was never lost (`py_type_base` carries `KEYWORD_METACLASS`). |
| PD-11 | `from shared.retry import retry` resolves to the MODULE, not the member | **FIXED** in `Parser@f44c060` — the member lookup runs before the submodule check, as the interpreter does. Verified: the 2 affected imports on two-service-fastapi now read `FUNCTION` + a real `PY_METHOD_` hash instead of `MODULE` + `""`. |
| PD-12 | `AUGMENTED_ASSIGNMENT` records no operator | **FIXED** in `Parser@027c9a0`. Stdlib re-measured at `main`: 1362 of 1362 wrappers carry `operatorString`, across all 13 operators (`+=` 1008, `-=` 173, `\|=` 79, `*=` 28, `//=` 26, `&=` 17, …). |
| PD-13 | `self.m()` resolved to an `@abstractmethod` declaration | **FIXED** in `Parser@027c9a0`. Not filed here, found by this document's author and recorded for completeness — see below. |

## Done vs pending, at a glance

**Done — nothing further needed from the parser.**
PD-1, PD-2, PD-3, PD-6 (retracted; stale IR, the parser was already correct), PD-5, PD-7 (the
`py_type_reference` half), PD-8, PD-9, PD-10, PD-11, PD-12, PD-13.

**Open by design — will not be "fixed".**
PD-4, the `type(x).a = v` misparse. tree-sitter resolves its own declared conflict between
`type_alias_statement` and `primary_expression` with `prec.dynamic(1)`, so the call node is
DELETED, not mis-shaped, and there is nothing to mint a `py_call_site` from. The parser
recovers the target, annotation, value and every nested call, and records the unrecoverable
part as a `py_parse_gap`. Two occurrences in the entire 784-module stdlib. The one fair
criticism is the disposition NAME: `MISPARSED_SILENTLY` describes what the grammar did, but it
sits on a row that exists because the parser caught it, so a reader meets the word "silently"
before the context. Renaming is a frozen-schema change and needs the human's word.

**DECIDED — not a parser item. Engine and modelling responsibility.**
The `object` / `type` / `super` gap below. Confirmed at `Parser@7eb2deb`: **0** `py_type` rows
named `object`, `type` or `super` anywhere in the stdlib IR, and **684 of 2,878 classes
(23.8%)** have no `__init__` on their own MRO.

Ruled: **keep the parser pure.** It will not synthesise `object`, `type`, `super`, implicit
`__init__` methods, or any other interpreter-provided behaviour into project IR. The contract
stands as written below, and there is **no parser fix pending for this item**.

---

## A parser change that was not a defect and still broke an edge

`Parser@19e4463` split **`ANNOTATED_ASSIGNMENT`** out of `ASSIGNMENT`, so that `x: int = 0`
and `x = 0` are no longer the same kind. That is a correct and wanted change — only one of
them declares a type — but it is a SILENT one for a consumer: the node keeps the same
children under the same edgeRoles, the same parent, the same byte range. Only `kind` moves.

`resolution/name-resolution.dl`'s `assign_pair` enumerated `"ASSIGNMENT"` as a literal, so it
simply stopped firing on those rows. Nothing failed; there was just less value flow.

**Measured on `test/python/projects/two-service-fastapi`:** 5 of 78 assignments (6.4%) carry
the new kind, and one of them cost a real edge —

```
shared/retry.py:11   AUDIT_LOG: List[str] = []
shared/retry.py:30   AUDIT_LOG.append(fn.__name__)
      old parser:  builtin:list.append          (boundary_lib)
      new parser:  -                            (ambiguous_unknown)   <- lost
```

The 12-case regression suite did **not** catch it: none of those fixtures uses an annotated
assignment, so all 12 goldens were byte-identical on both parsers. The project corpus is what
caught it, which is the argument for keeping a project-shaped corpus alongside the cases.

`assign_pair` now enumerates the kinds through an `assign_kind` relation rather than matching
one literal, so a THIRD assignment kind is a one-line change in a visible place instead of a
silent loss. Frequency is corpus-dependent and worth knowing: 6.4% of assignments on the
typed FastAPI project, but 2 in 6,031 on a 77-file stdlib corpus — annotated assignment is a
property of MODERN typed application code, which is exactly the code this engine is aimed at.

---

## The lesson I owe the parser author

Four of the ten were measured against `Parser/analysis-results/python/linkage-sample`, a
CHECKED-IN IR export that predates the parser it was compared to. PD-2 even diagnosed the
cause — "the two IRs in the tree are not from the same parser build" — and the other three
were filed anyway instead of being re-measured against a fresh parse. **Every defect below
is now stated against a fresh parse of `test/python/projects/two-service-fastapi`, produced
by the parser at the revision named in the heading.** A finding measured against a stale
export is not a finding.

---

## PD-12 · the `AUGMENTED_ASSIGNMENT` wrapper does not record WHICH operator — FIXED

**Fixed in `Parser@027c9a0`.** tree-sitter exposes the operator as its own field on
`augmented_assignment`, so nothing had to be recovered from text. Re-measured on the 784-module
3.10.4 stdlib at `Parser@7eb2deb`: **1362 of 1362** wrappers carry `operatorString`, spanning
all thirteen operators. The filing below is left as written; its reasoning is what made the
fix worth doing ahead of a consumer for it.

---


**Construct** any augmented assignment: `a += b`, `flags |= F`, `opts |= {...}`.

`Parser@19e4463` correctly replaced two orphan depth-0 roots with one wrapper parenting an
ASSIGNMENT_TARGET and an ASSIGNMENT_VALUE — the pairing that was simply absent before, and
the right call over recovering it downstream by `(scope, line)`. But `operatorString` (c13)
is EMPTY on the wrapper, so the thirteen augmented operators are one undifferentiated kind.

**Repro** 77-file stdlib corpus (`asyncio`, `json`, `http`, `email`, `logging`, `typing`,
`dataclasses`), parsed at `main`:

```
185 AUGMENTED_ASSIGNMENT wrappers, operatorString = "" on 185 of 185
```

The column IS populated on every other operator-bearing kind in the same export —
`BINARY_OPERATION +` 397, `COMPARISON ==` 568, `UNARY_OPERATION not` 706 — so this is an
unfilled column on one kind, not a schema position that does not exist.

**Cost** low today and structural tomorrow. `a += b` is a UNION, not a replacement, so the
engine must not feed it to `assign_pair`; the operator is what says which union. `d |= other`
merges a dict and is the 3.9+ spelling of the registry-population shape
`collection-flow.dl` already resolves through `dict_store_entry`, while `n += 1` carries no
flow at all. Measured value-side kinds on the same corpus: 102 LITERAL, 36 NAME_REFERENCE,
17 CALL, 1 LIST — so the call-graph yield of consuming these TODAY is ~zero, which is why
the engine does not, and why this is filed rather than worked around.

---

## PD-13 · `self.m()` resolved to an `@abstractmethod` declaration — FIXED

**Not filed here.** Found by this document's author while measuring whether the parser's
recent commits were worth consuming, and recorded because the finding was right and the cause
was a parser over-correction.

`Parser@2c2396f` removed a `bodyIsStub` filter from `singleMethodOn`. That filter had been
losing 159 stdlib self-dispatches, because a `pass`-bodied hook — `ParserBase.unknown_decl`,
`Bdb.user_line`, `Cmd.preloop` — really does run when nothing overrides it. But removing it
outright then let `self.send(...)` resolve to

```python
class Transport(ABC):
    @abstractmethod
    def send(self, route: str, payload: Payload) -> Payload:
        ...
```

which never runs. A chain through that answer dead-ends one hop in, and the engine's concrete
answer was the right one. That is what took `crosscheck-callee-differs` from 3 to 10 sites on
`two-service-fastapi`.

Three properties share the word "stub" and only two of them mean "not a call target":

| | meaning | call target? |
|---|---|---|
| `OVERLOAD_STUB` | a declaration with no implementation | no |
| `ABSTRACT_METHOD` | an implementation the subclass supplies | no |
| `bodyIsStub` | the body is `pass` or `...` | **says nothing** |

Abstractness is the axis that matters, and the parser already recorded it as
`ABSTRACT_METHOD` / `ABSTRACT`. Now filtered by kind. Verified at `Parser@7eb2deb`: **0** call
sites on `two-service-fastapi` resolve to an abstract method, while `self.on_line(1)` on a
`pass`-bodied hook still resolves. Stdlib linked call sites 24,830 → 24,960 → 25,026.

---

## PD-11 · `from pkg.mod import mod` binds the MODULE, not the member  — FIXED

**Fixed in `Parser@f44c060`.** The write-up below is as filed. The engine mitigation stays,
and is not dead code: it resolves the member from `packageOrTypeName` + `originalName`, which
works identically against the LIBRARY IR, where a client-run hash could never have matched.
Confirmed still exercised after the fix — `crosscheck-callee-*` shows the engine and the
parser now naming the same `shared.retry.retry`.

**Construct** a from-import whose member name equals its own module's last segment.

**Repro** fresh parse, `test/python/projects/two-service-fastapi`:

```
# shared/retry.py defines BOTH the module `shared.retry` and a function `retry` in it
# inventory_service/handlers.py:  from shared.retry import audited, retry

importKind=FROM_MEMBER  importedPath=shared.retry.audited  simpleName=audited  resolvedTargetKind=FUNCTION  ✓
importKind=FROM_MEMBER  importedPath=shared.retry.retry    simpleName=retry    resolvedTargetKind=MODULE    ✗
```

Two names on one statement; the second resolves to the module `shared.retry` rather than
to the function `retry` inside it, with an empty `resolvedTargetHash`.

**Column** §2.14 c13 `resolvedTargetKind` / c14 `resolvedTargetHash`.

**Cost** the bound name is a FUNCTION and reads as a MODULE, so every call through it has
the wrong kind of target. Measured: it silently broke the entire `@retry` decorator chain
in BOTH services — `handlers.checkout(...)` and `handlers.get_item(...)` had no target at
all — and the shape is ordinary (`from app.tasks import tasks`,
`from pkg.logging import logging`).

**Engine mitigation, and why it is better than the FK anyway**
`resolution/name-resolution.dl` resolves a member import from two columns that ARE exact:
`packageOrTypeName` ("shared.retry") and `originalName` ("retry") — a module with that
qualifiedName, and a member of it with that name. No string splitting, no FK, and it works
identically against the library IR where no hash could ever have matched.

---

## Original filings, kept for the record

The detailed write-ups below are as originally filed. Read them against the status table
above: where a row says RETRACTED, the measurement was taken from the stale checked-in IR
and does not hold on a fresh parse.

---

## PD-1 · `py_binding.targetEntityKind` / `targetEntityHash` are never populated

**Construct** any bound name at all.

**Repro** `Parser/analysis-results/python/linkage-sample`:

```
awk -F'\t' 'NR>1{print $23"\t"($24==""?"NOHASH":"HASH")}' all-python-bindings.csv | sort | uniq -c
   195 NONE	NOHASH
```

195 of 195 rows. Same on all 12 test fixtures.

**Column** §2.3 c22 `targetEntityKind` — documented as
`TYPE | METHOD | IMPORT | PARAMETER | VARIABLE | MODULE | TYPE_VAR | TYPE_ALIAS | NONE`
— and c23 `targetEntityHash`, documented as `FK→py_type/py_method/py_import/py_method_parameter`.

**Cost** this is the schema's designated name→entity channel, and it is the single
highest-value pre-resolution the parser could offer: it would answer "what does this name
mean" for the 50.7% of attribute calls with a bare-name receiver directly. Empty, it costs
every bare-name edge unless the engine rebuilds the answer.

**What the engine does instead** composes four structural links that ARE populated —
`py_method.declaringBindingLinkHash` (c23), `py_type.declaringBindingLinkHash` (c17),
`py_import.bindingLinkHash` (c21) and `py_expression.bindingLinkHash` (c26) — plus an
explicit LEGB walk (`resolution/name-resolution.dl`). That is strictly better than the
column would have been, because the walk is driven by symtable's own `bindingKind` and is
therefore scope-exact; but it is ~90 lines the column was supposed to make unnecessary.
`binding_pre_target` is projected anyway so the agreement rate stays measurable rather
than assumed.

---

## PD-2 · No `ASSIGNMENT` node in the linkage-sample IR — target and value cannot be paired

**Construct** `x = value`, any form.

**Repro** two IRs produced by different parser builds disagree structurally:

```
# Parser/analysis-results/python/linkage-sample
cut -f1 all-python-expressions.csv | tail -n +2 | sort -u
  ATTRIBUTE_ACCESS CALL CLS_REFERENCE ELLIPSIS LIST LITERAL NAME_REFERENCE SELF_REFERENCE
  # -> 0 ASSIGNMENT nodes, but 24 rootContext=ASSIGNMENT_TARGET and 24 =ASSIGNMENT_VALUE roots

# python/v3.10.4/_stdlib_base
awk -F'\t' 'FNR>1{print $1}' all-python-expressions.csv | sort | uniq -c | grep ASSIGNMENT
  20531 ASSIGNMENT      # -> parents an ASSIGNMENT_TARGET and an ASSIGNMENT_VALUE child
```

**Column** `py_expression.kind` — `ASSIGNMENT` is in the frozen enum (§2.15) and the
library IR emits it; the linkage-sample IR does not, leaving target and value as two
unrelated ROOTs (`parentExpressionHash = ""`).

**Cost** in the no-ASSIGNMENT shape, a target can only be paired with its value by
`(scope, startLine)`. That is ambiguous for a tuple unpack (`a, b = f(), g()`) and for two
assignments on one line, so every value-flow answer — attribute typing, single-binding
alias resolution, dict-literal entries — is silently unreliable there. It cost the two
`self.base.describe()` / `self.child.merge()` edges on linkage-sample until the fallback
was written.

**What the engine does** `assign_pair` carries both shapes; the clauses are naturally
disjoint because in the ASSIGNMENT shape neither node is a root. **Recommend: confirm
which shape is current and re-export linkage-sample**, since the two IRs in the tree today
are not from the same parser.

---

## PD-3 · `all-python-decorators.csv` absent from the linkage-sample IR

**Construct** any decorator.

**Repro** `linkage-sample/src` contains 6 decorators (`@overload` ×2, `@staticmethod`,
`@classmethod`, `@property`, `@audit("child")`) and 6 `rootContext=DECORATOR` expressions,
but the export has no `all-python-decorators.csv` at all — while the 3.10.4 library shards
do (598 rows in `_stdlib_base`).

**Column** whole relation, §2.12.

**Cost** `py_decorator` is the only place `replacesTarget` and `applicationOrder` live, so
without it the engine cannot tell `@passthrough` (the name still means the `def`) from
`@replacing` (the `def` is never called). Measured on `07-decorators`, where the relation
IS present: ungated, three names resolved to the `def` written under them and CPython's
answer was a different function each time — **3 fabricated edges**. On linkage-sample the
decorator layer simply cannot run, so `fn(*args, **kwargs)` in `models.audit` stays a
declared unknown even though the identical shape resolves exactly in `07-decorators`.

---

## PD-4 · `MISPARSED_SILENTLY` — `type(x).attr = v` parses as a type alias

**Construct** the 3.12 soft keyword `type` used as the builtin.

**Repro** the whole 3.10.4 stdlib, 2 rows, both in `unittest/mock.py`:

```
awk 'FNR>1' */all-python-parse-gaps.csv
  PY_MODULE_a65a22…  SOFT_KEYWORD_MISPARSE  MISPARSED_SILENTLY  125  type(mock)._mock_check_sig = checksig
  PY_MODULE_a65a22…  SOFT_KEYWORD_MISPARSE  MISPARSED_SILENTLY  126  type(mock).__signature__ = sig
```

**Column** `py_parse_gap.disposition`. The disposition is the point: `hasError` is false,
so the facts are **wrong rather than missing** and nothing downstream can notice.

**Cost** the outer `type(...)` call node is lost, so the call site is absent from
`py_call_site` — one dropped site per occurrence, invisible to any check whose denominator
is the IR itself. `test/python/tools/coverage_guard.py`'s second inventory (CPython's own
`dis`) is the only thing that can see it.

**Not fixable in the tokeniser** — `grammar.js:58` declares
`conflicts: [$.type_alias_statement, $.primary_expression]` and `grammar.js:464` gives
`prec.dynamic(1, seq('type', …))`, so tree-sitter prefers the alias reading. Post-correction
(what the parser does) or a grammar fork are the only options. **Do not** synthesise a call
site from the keyword byte range: every cross-stage join keys on real node byte ranges.

**Engine handling** `parse_gap_misparsed_silently` is exported
(`parser-defect-misparsed-silently.csv`) so a consumer can subtract the affected modules
rather than trust them.

---

## PD-5 · Builtin names get `bindingKind=GLOBAL_IMPLICIT` and `bindingOrigin=ASSIGNMENT`

**Construct** any reference to a builtin.

**Repro** linkage-sample:

```
awk -F'\t' 'NR>1 && $1=="super"{print $3"\t"$4"\t"$16}' all-python-bindings.csv | sort -u
  GLOBAL_IMPLICIT	ASSIGNMENT	0
```

**Column** §2.3 c2 `bindingKind` provides `BUILTIN`, and it is never used. c3
`bindingOrigin` reads `ASSIGNMENT` for a name that is never assigned — a default leaking
into a semantic column.

**Cost** the honest signal for "this name is a builtin" is absent, so the engine has to
infer it from *absence*: the LEGB walk finding no declaration anywhere. That works
(`resolution/builtins.dl` gets all 7 `super()` sites and every `print`/`str`/`getattr`),
but it is indirect, and it made a real bug: a builtin referenced **at module scope** has its
GLOBAL_IMPLICIT binding in the module scope itself, so the walk matched it against itself
and reported "resolved". Measured on `12-blind-spots`: module-level `exec(_src, _ns)` came
out `ambiguous_unknown / no_rule` while the identical call inside a function was correctly
named `builtin:exec`. Fixed by requiring `b2 != b`; a populated `BUILTIN` kind would have
made the rule unnecessary. `bindingCount=0` is a usable proxy and is what the alias rule
relies on.

---

## PD-6 · `py_field.pyExpressionLinkHash` is never populated

**Construct** any attribute.

**Repro** linkage-sample, 11 of 11 field rows:

```
awk -F'\t' 'NR>1{print ($27==""?"EMPTY":"SET")}' all-python-fields.csv | sort | uniq -c
   11 EMPTY
```

**Column** §2.9 c26 `pyExpressionLinkHash`, documented as
"FK→`py_expression` — first write's target node".

**Cost** this is the only documented path from a field row to the value it was written
from, so **attribute typing is unreachable without it** — and attribute typing is what
resolves the two sites `deferred.py`'s own docstring calls "expected UNRESOLVED, needs
attribute typing". `initializerText` (c22) holds `Base("b")` as *text*, which is a string, not
a link.

**What the engine does** derives the write target from `py_expression` — an
ATTRIBUTE_ACCESS whose `literalValue` is the field name, whose ATTRIBUTE_OBJECT is a
SELF_REFERENCE, whose owner type is the field's owner, and whose `nameContext` is STORE.
Note this needs `nameContext` (c27) and NOT `bindingLinkHash`: an attribute access binds no
name, so it has no binding row, and STORE is the only signal distinguishing a write from a
read.

---

## PD-7 · `py_type_base.pyExpressionLinkHash` **and** `py_type_reference.pyExpressionLinkHash` are both empty

**Construct** any base class.

**Repro** linkage-sample, 8 of 8 base rows and 12 of 12 type-reference rows:

```
awk -F'\t' 'NR>1{print ($9==""?"EMPTY":"SET")}' all-python-type-bases.csv      | sort | uniq -c   # 8 EMPTY
awk -F'\t' 'NR>1{print ($23==""?"EMPTY":"SET")}' all-python-type-references.csv | sort | uniq -c   # 12 EMPTY
```

`py_type_reference.pyScopeLinkHash` (c17) is also empty for every `context=BASE_CLASS` row,
so the twin row cannot be resolved by scope either.

**Column** §2.5 c8 and §2.6 c22. The schema is explicit that the twin type_reference row
(`py_type_base` c9, which IS populated) exists so "the existing `type_ref_resolves`
machinery resolves base names with no new rules" — but with no expression and no scope on
either row, there is nothing to resolve *from*.

**Cost** without a link from a base slot to its expression, **every base-shape rule is
unreachable** and the entire class hierarchy has to come from
`py_type_base.resolvedTypeLinkHash` — the parser's own run-local answer, which is exactly
the dependency this engine exists to avoid, and which is empty for 1,450 of 2,859 library
base rows (50.7%) and for the one interesting case on linkage-sample (`class
ViaAlias(_Aliased)`, `isResolvedLocally=false`).

**What the engine does** recovers the expression from
`(module, startLine, position, baseSimpleName)`, which is unique: two positional bases of
one class cannot share a position, and two class statements cannot share a line. Result: all
8 client bases resolved by the engine's own rules, 0 falling back to the parser.

---

## PD-8 · `from . import models` sets `resolvedTargetKind=MODULE` but leaves `resolvedTargetHash` empty and `isModuleImport=false`

**Construct** a relative module import.

**Repro** linkage-sample `dotted.py:2`:

```
importKind=RELATIVE_MEMBER  importedPath=models  simpleName=models
isModuleImport=false                       <- but the bound name IS a module
resolvedTargetKind=MODULE  resolvedTargetHash=""   <- kind says MODULE, hash is empty
resolvedModuleLinkHash=PY_MODULE_d423fc…           <- the hash is HERE instead
```

**Column** §2.14 c8 `isModuleImport` ("the bound name refers to a module, not a member"),
c13/c14 `resolvedTargetKind`/`resolvedTargetHash`.

**Cost** a rule keyed on `resolvedTargetHash` — the documented FK — misses every relative
module import, which is asyncio's house style and 38% of from-imports corpus-wide. It cost
both dotted bases in `dotted.py` (`class DottedChild(models.Base)`).

---

## PD-9 · A subscript call is `callKind=DYNAMIC_CALL`, not `SUBSCRIPT_CALL`

**Construct** `TABLE["double"](21)` / `REGISTRY["go"]()`.

**Repro** `test/python/cases/08-callables/src/main.py:53` and
`07-decorators/src/main.py:108`:

```
awk -F'\t' 'NR>1{print $1"\t"$2"\t"$5}' all-python-call-sites.csv | grep DYNAMIC
  DYNAMIC_CALL		NONE       # calleeName empty
```

**Column** §2.16 c0 `callKind`. The enum provides `SUBSCRIPT_CALL` for exactly this shape;
`DYNAMIC_CALL` is documented (§4.5) as the getattr/eval/exec marker, i.e. "unresolvable by
construction".

**Cost** the two are conflated, so a consumer that trusts the kind refuses to try a site
that is fully resolvable: both of the above resolve exactly through dict-literal and
subscript-store flow (`resolution/collection-flow.dl`), giving the click/Flask decorator-
registry edge `main → handler`. Reporting them as dynamic would also overstate the
"unresolvable by construction" count, which is a number this project quotes.

---

## PD-10 · `class C(metaclass=M)` emits two BASE_CLASS expressions with the same position and no keyword name

**Construct** a keyword base.

**Repro** `12-blind-spots/src/main.py:50` — `class Built(metaclass=Installer)`:

```
NAME_REFERENCE  role=BASE_CLASS  lit=metaclass   pos=0  argumentKeywordName=""
NAME_REFERENCE  role=BASE_CLASS  lit=Installer   pos=0  argumentKeywordName=""
```

**Column** `py_expression.edgeRole` (the keyword NAME is not a base class) and c29
`argumentKeywordName`, which exists for exactly this and is empty. `py_type_base` gets it
right — one `KEYWORD_METACLASS` row with `keywordName=metaclass`, `position=""` — so only
the expression layer is affected.

**Cost** role and position cannot distinguish the keyword from its value, so the metaclass
expression can only be found by matching `literalValue` against
`py_type_base.baseText`. That is exact for this shape but would be ambiguous if a
positional base were itself named `metaclass`. It also means a rule that trusts
`edgeRole=BASE_CLASS` to enumerate bases will count `metaclass` as one.

---

## Not a defect, but worth a decision: `object`, `type` and `super` have no rows anywhere

The 3.10.4 stdlib IR contains **zero** `py_type` rows named `object`, `type` or `super` —
correctly, since those are C-implemented and the IR is built from Python source. The
consequence is structural rather than accidental:

* every class's MRO ends outside the fact base, so a constructor call on a class with no
  `__init__` (`Sibling()` on linkage-sample, `Both()`/`Left()` in `05-super`) has no
  nameable target;
* `super().__new__(...)` in a class deriving from `type` runs off the end of the MRO.

The engine treats these as **named library boundaries** (`builtin:object.__init__`,
`builtin:type.__new__`) rather than as blind spots, via an explicit catalog in
`resolution/builtins.dl`.

**DECIDED. This is an engine and modelling responsibility, not a parser one, and the catalog
approach is endorsed.**

### The parser contract, stated so it is not re-litigated

> Every emitted row traces back to bytes from a file that was actually parsed. If something is
> absent from the source, that absence remains meaningful.

`object`, `type` and `super` are C-implemented, so no byte range in any parsed file declares
them. Emitting rows for them would put provenance-free facts into the same relations as parsed
ones, and a consumer could not tell the two apart. The moment one relation carries a row that
no file produced, "unresolved means genuinely unresolved" stops being true everywhere — which
is the single property the rest of this document relies on when it distinguishes a defect from
a boundary. The same reasoning rules out synthesising an implicit `__init__` onto the 684
classes that lack one: Python provides that at runtime, the source does not.

### What is sanctioned instead

Model interpreter semantics SEPARATELY and let the engine reason over them. A version-pinned
builtins shard is fine as **external semantic input** — it would slot into the existing
`--library` staging with no engine change, and is small and bounded: 94 builtin types and
about 726 members, introspected from the pinned interpreter rather than taken from typeshed,
which is a separately-maintained declaration that can disagree with the interpreter actually
running.

It must not be presented as parser-derived project IR. Whatever produces it is a different
tool with a different provenance claim, and its rows should be identifiable as such.

**No parser work is pending here.** The item is closed on the parser side.
