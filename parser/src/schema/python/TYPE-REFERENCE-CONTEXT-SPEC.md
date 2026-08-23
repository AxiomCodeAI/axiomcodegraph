# py_type_reference.context — enum spec and tier classification

**Author:** A0. **Implementer:** A3. **Status:** proposed, urgent — A3 is implementing
`py_type_reference` now.

Same treatment as `typeCategory` / `methodKind` / `importKind`: sort by what can
adjudicate it, promote what is adjudicable, spec only the residue. **Verified against
CPython 3.10.4, not assumed** — and the guess that "most of it is tier 1 from the AST
parent" is *mostly* right and wrong in one important place (§3).

---

## 1. Freeze impact — additive, confirmed

`py_type_reference` is **already declared** in `decls_base_py.dl` at 25 columns, in the
DEFERRED block. Un-deferring it:

- adds **no column** to any frozen spine relation,
- moves **no column position** anywhere,
- changes the frozen spine not at all: still 10 relations / 262 columns,
- leaves `gen_decls.py --check` green (verified).

Its FKs point **into** the spine (`pyTypeLinkHash`, `pyScopeLinkHash`,
`pyModuleLinkHash`, `pyExpressionLinkHash`, `referencedTypeLinkHash`), never out of it,
which is exactly the property §10 of the schema doc relied on when deferring it.
**The freeze is not reopened.**

One correction to the brief: Java's `TypeRefContext` has **23 values, all 23 produced**
by the extractor (I checked `src/parsers/java/` for each). Not 18.

---

## 2. Tier classification

| Tier | Count | Contexts |
|---|---|---|
| **1 — AST structural** | **9** | `BASE_CLASS`, `METACLASS`, `METHOD_RETURN`, `METHOD_PARAM`, `FIELD_TYPE`, `VARIABLE_ANNOTATION`, `EXCEPT_TYPE`, `RAISE_TYPE`, `GENERIC_ARGUMENT` |
| **2 — introspection** | **0** | Type *references* are syntax. The runtime sees resolved objects, not the reference sites, so `inspect` contributes nothing here. |
| **3 — spec** | **5** | `ISINSTANCE_TYPE`, `ISSUBCLASS_TYPE`, `CAST_TARGET`, `TYPEVAR_BOUND`, `TYPE_ALIAS` |
| **deferred** | 2 | `OVERLOAD_SIGNATURE`, `TYPE_COMMENT` — see §5 |

Note tier 2 is **empty** for this field, which is itself worth stating: unlike
`typeCategory`, introspection offers no second opinion, so the tier-3 residue has no
independent check at all. It is spec, and only spec.

---

## 3. The finding: call-based contexts are NOT tier 1

The guess was that the AST parent determines the context. For 9 of 14 it does. For the
other 5 it provably cannot, and the evidence is that **the parent chains are identical**:

```
Foo      Call.args <- Expr.value <- Module.body      callee=isinstance
Bar      Call.args <- Expr.value <- Module.body      callee=issubclass
Baz      Call.args <- Expr.value <- Module.body      callee=cast
Widget   Call.args <- Expr.value <- Module.body      callee=register     <- NOT a type ref
Config   Call.args <- Expr.value <- Module.body      callee=partial      <- NOT a type ref
```

Shape alone cannot separate `isinstance(o, Foo)` from `register(handler, Widget)`. Only
the **callee name** does, and that is a recognition list — **precisely the judgment that
put `importKind = DYNAMIC` in tier 3.** Applying the same standard puts these there too.

Worse than the `importKind` case: there, the shape at least told you it *was* an import.
Here, without the name list you cannot tell the argument is a type reference **at all**,
so a wrong list produces both false positives and false negatives.

The same holds for aliases:

```
Alias  = List[Int]     Subscript.value <- Assign.value    <- byte-identical
values = List[Int]     Subscript.value <- Assign.value    <- byte-identical
```

`TYPE_ALIAS` is undecidable from shape. A capitalised target is a *convention*, not a rule.

**Frequency, so the cost is known rather than guessed** (measured earlier over 844 files):
`isinstance` **2,123** sites, `cast` **359**, `issubclass` **88**. `isinstance` is the
single largest narrowing lever against a 24.6-candidate fan-out, so this residue is
small in count and large in value. It deserves the tier-3 label precisely because it
matters.

---

## 4. Tier 1 — the decision procedure

Derived from the parent chain `(parentNodeType, fieldName)` plus depth. Evaluate in this
order; **first match wins**.

```
 1. Subscript.slice, at any depth inside an established type context
                                          -> GENERIC_ARGUMENT      (depth >= 1)
 2. ClassDef.bases                        -> BASE_CLASS
 3. ClassDef.keywords, keyword.arg == "metaclass"
                                          -> METACLASS
 4. ClassDef.keywords, any other arg      -> (no type reference; it is a value)
 5. FunctionDef/AsyncFunctionDef.returns  -> METHOD_RETURN
 6. arg.annotation  (via arguments.args / posonlyargs / kwonlyargs / vararg / kwarg)
                                          -> METHOD_PARAM
 7. AnnAssign.annotation, nearest enclosing scope is a CLASS body
                                          -> FIELD_TYPE
 8. AnnAssign.annotation, otherwise       -> VARIABLE_ANNOTATION
 9. ExceptHandler.type  (incl. Tuple.elts beneath it)
                                          -> EXCEPT_TYPE
10. Raise.exc, or Call.func beneath Raise.exc
                                          -> RAISE_TYPE
```

Verified for every one of these: the chain is unique and needs no name list.

### 4.1 Precedence where a use sits in more than one context

**Rule: the outermost enclosing construct sets the context at depth 0; everything nested
inside a subscript is `GENERIC_ARGUMENT`, and `parentReferenceHash` carries the link.**
This is exactly the tree shape A3 is building, and it means precedence never needs a
tie-break — the two facts live on different rows.

| Source | depth 0 | depth ≥ 1 |
|---|---|---|
| `x: List[Inner]` | `List` → `VARIABLE_ANNOTATION` | `Inner` → `GENERIC_ARGUMENT` |
| `attr: Field` in a class body | `Field` → `FIELD_TYPE` | — |
| `class G(Generic[T])` | `Generic` → `BASE_CLASS` | `T` → `GENERIC_ARGUMENT` |
| `def f(a: Dict[K, List[V]])` | `Dict` → `METHOD_PARAM` | `K`, `List`, `V` → `GENERIC_ARGUMENT` |
| `except (A, B)` | — | `A`, `B` → `EXCEPT_TYPE` (see below) |

Two explicit tie-breaks that are otherwise ambiguous:

- **`FIELD_TYPE` beats `VARIABLE_ANNOTATION`.** An `AnnAssign` in a class body is both.
  Field wins because the enclosing type is what the engine joins on; the variable reading
  is recoverable from `pyScopeLinkHash` anyway.
- **A tuple of exception types is flattened to depth 0, not treated as a generic.**
  `except (A, B)` gives two `EXCEPT_TYPE` rows at depth 0 with `position` 0 and 1 — the
  `Tuple` is exception-handler syntax, not a parameterised type, so emitting it as a
  depth-0 container with two `GENERIC_ARGUMENT` children would be wrong. Same for
  `raise` with a tuple.

---

## 5. Java's 23 values mapped

### Java → Python, direct analogue (9)

| Java | Python | Tier |
|---|---|---|
| `SUPER_TYPE` | `BASE_CLASS` | 1 |
| `IMPLEMENTS_INTERFACE` | **`BASE_CLASS`** (merged — see below) | 1 |
| `FIELD_TYPE` | `FIELD_TYPE` | 1 |
| `METHOD_RETURN` | `METHOD_RETURN` | 1 |
| `METHOD_PARAM` | `METHOD_PARAM` | 1 |
| `LOCAL_VARIABLE` | `VARIABLE_ANNOTATION` | 1 |
| `CAST_EXPRESSION` | `CAST_TARGET` | **3** |
| `INSTANCEOF_TYPE` | `ISINSTANCE_TYPE` | **3** |
| `METHOD_TYPE_ARGUMENT` | `GENERIC_ARGUMENT` | 1 |

### Java values with NO Python counterpart (7) — stated, not invented

| Java | Why there is none |
|---|---|
| `THROWS_CLAUSE` | **Python has no `throws`.** A function does not declare what it raises. `py_method.throwsExceptions` (c19) is an *inferred* set from `raise` statements in the body, explicitly an under-approximation. The reference site is `RAISE_TYPE`, which is a different fact: it is where an exception is *constructed*, not where it is *declared*. Do not map one to the other. |
| `IMPLEMENTS_INTERFACE` | Python has no interface/class distinction. `class C(Proto)` and `class C(Base)` are the same syntax; whether `Proto` is a Protocol is a property of the *referenced type* (`typeCategory`), not of the reference. Merged into `BASE_CLASS`; `py_type_base.position` preserves order and `referencedTypeLinkHash` recovers the category. |
| `PERMITS` | Sealed classes are Java 17. No Python equivalent at any version. |
| `TYPE_PARAM_BOUND` | Pre-PEP 695 there are no syntactic type parameters. The nearest thing is `TypeVar("T", bound=X)`, which is a **call argument** → `TYPEVAR_BOUND`, tier 3. |
| `METHOD_TYPE_PARAM_BOUND` | Same; PEP 695 deferred. |
| `ARRAY_CREATION_TYPE` | Python has no array-creation syntax. `[]`/`list()` carry no element type. |
| `METHOD_REFERENCE_QUALIFIER` | No `::` operator. `obj.method` is an ordinary attribute access, already a `py_expression`. |

Also unmapped, and deliberately: `ANNOTATION_TYPE`, `ANNOTATION_PARAM`,
`TYPE_PARAMETER_ANNOTATION` — Python decorators are **calls, not annotations**, and are
modelled by `py_decorator` (§4.3 of the schema). A decorator name is not a type
reference; treating `@app.route` as one would flood the relation with framework noise.
`OBJECT_CREATION_TYPE` is likewise absent: `Foo()` is a `CALL`, and per §4.5 the parser
does not guess construction — that fact lives in `py_type_inference`.

### Python values with NO Java counterpart (5)

| Python | Tier | Why Java has none |
|---|---|---|
| `EXCEPT_TYPE` | 1 | Java's catch parameter is a `LOCAL_VARIABLE` declaration; Python's `except X` names a type in a position that is neither a declaration nor a cast. |
| `RAISE_TYPE` | 1 | Java's `throw` takes an expression, and the declared set is `THROWS_CLAUSE`. Python has only the construction site. |
| `MATCH_CLASS_PATTERN` | 1 | `case Point(x=0)` — `MatchClass.cls`. Java's `RECORD_PATTERN_TYPE` is the closest relative but is record-specific; Python's applies to any class. Chain verified unique: `MatchClass.cls`. |
| `TYPE_ALIAS` | **3** | Java aliases do not exist pre-Valhalla. And in Python it is undecidable from shape (§3). |
| `TYPEVAR_BOUND` | **3** | Java's bound is syntax (`<T extends X>`); Python's is a call argument. |

`TYPE_COMMENT` (PEP 484 `# type:`) is a **sixth** Python-only context. It is real and
valid on 3.10, but it needs `ast.parse(type_comments=True)`, which is a different parse
mode. **Deferred**, with `isTypeCommentDerived` (c20) already reserved for it. Filed so
it is a decision, not an oversight.

`OVERLOAD_SIGNATURE` is likewise deferred: an `@overload` stub's parameter and return
annotations are already `METHOD_PARAM` / `METHOD_RETURN` on a method whose
`methodKind = OVERLOAD_STUB`. A separate context would duplicate that with no new
information.

---

## 6. Tier 3 — the residue, as a decision procedure

> Same caveat as the other tier-3 spec: **this buys author separation, not ground
> truth.** And here tier 2 is empty, so there is no independent check whatsoever. If a
> rule below is wrong, nothing in the harness will say so.

### 6.1 Call-based contexts — exact callee lists, no heuristics

Emit a type reference for a call argument **only** when the callee's dotted path matches
exactly. A prefix or suffix heuristic would catch `self.cast_vote(x, Ballot)`.

| Callee (exact) | Argument | Context |
|---|---|---|
| `isinstance` | positional 1 (and each `Tuple` element of it) | `ISINSTANCE_TYPE` |
| `issubclass` | positional 1 (and each `Tuple` element) | `ISSUBCLASS_TYPE` |
| `cast`, `typing.cast`, `t.cast` | positional 0 | `CAST_TARGET` |
| `TypeVar`, `typing.TypeVar` | keyword `bound`; each positional after 0 (the constraints) | `TYPEVAR_BOUND` |

Aliased callees (`from typing import cast as c`) are **out of scope**: resolving the
alias needs the binding table, and `context` is assigned during extraction. Emit nothing
rather than half-resolve — the same call made for `importKind = DYNAMIC`.

A `Tuple` argument to `isinstance`/`issubclass` is flattened: one row per element at
depth 0, `position` 0..n. It is a set of alternatives, not a parameterised type.

### 6.2 `TYPE_ALIAS`

Undecidable from shape. Emit `TYPE_ALIAS` **only** when there is explicit evidence:

1. the target is annotated `: TypeAlias` (PEP 613), **or**
2. the value is a subscript of a known `typing` generic (`List`, `Dict`, `Optional`,
   `Union`, `Callable`, `Tuple`, `Type`, `Sequence`, `Mapping`, `Iterable`, `Set`,
   `FrozenSet`, `Literal`) **and** the assignment target is a bare `Name`.

Otherwise emit the reference with the ordinary expression context and **no**
`TYPE_ALIAS`. Case 2 is a heuristic and is marked as one: emit
`residue = "TYPE_ALIAS_HEURISTIC"` so A5's residue-rate reporting (§7 of the field spec)
counts it. A capitalised name alone is **not** sufficient evidence.

---

## 7. For A3 — you are implementing this now

- The tier-1 procedure in §4 is what the extractor should implement; it needs no name
  list and no judgment.
- The five tier-3 contexts in §6 need the exact lists given. **Do not extend them from
  intuition** — file an addition instead, the way the `importKind` list is filed.
- Emit `residue` on tier-3 rows (`TYPE_ALIAS_HEURISTIC`, and `CALLEE_ALIASED` if you
  detect an aliased `cast`/`isinstance`) so the rate is visible rather than silent.
- **If your implementation already contradicts this spec, file it — do not bend the spec
  and do not silently converge.** The whole reason this document exists is that you
  authoring it while implementing puts spec and code under one author.
- I will add oracle predicates for the 9 tier-1 contexts to `emit_oracle.py` next, so
  they are Gate-1 adjudicated rather than taken on trust.
