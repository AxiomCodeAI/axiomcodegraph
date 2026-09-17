# Every link column, and what asserts it

The LINQ finding, generalised. `from x in xs` ranged over `x` and filed `xs` as
its body; the links were PRESENT and pointed at the WRONG rows, and the first
sufficiency table scored them 100% because it asked whether a link existed and
not what it pointed at. So: every column of the 22 relations that names another
row, and for each one which of three things asserts it.

- **MEANING** — a gate checks the pointed-at row is the RIGHT one: its name,
  kind, position or content is compared to an expectation, or the pair is
  asserted 1:1 in both directions.
- **EXISTENCE** — a gate reads the column, but only to check it resolves, to
  count non-empty values, or to select rows by it. A link to the wrong row of
  the right relation passes.
- **INTEGRITY** — nothing in the shipping suite reads it; `cs-verify.ts`
  checks that a non-empty value names a row that exists.
- **ABSENT** — the column is never written. A declared hop nobody emits.

Enumerated from each registry's `getCsvHeader()`: every column ending in
`Hash` or naming a group key, excluding the primary key and
`serviceVersionLinkHash`. **67 columns.**

| relation | column | asserted by | where, or what is missing |
|---|---|---|---|
| cs_attribute_argument | parentAttributeHash | MEANING | arguments counted and read per named attribute |
| cs_attribute_argument | referencedTypeReferenceLinkHash | MEANING | `typeof(Documented<int>)` links to a reference named Documented with the argument int |
| cs_attribute_argument | csExpressionLinkHash | MEANING | `(byte)42` links to a CAST row, `typeof(Documented<int>)` to a TYPEOF row |
| cs_attribute | ownerHash | MEANING | `[Obsolete]`'s owner is the method it decorates, by name |
| cs_attribute | csTypeLinkHash | MEANING | the ENCLOSING type by name: `[Serializable]` → Documented, `[event: MyMarker]` → Generic, nested `Inner`'s `[Obsolete]` → Inner (was '' for every member; the code's own comment said otherwise) |
| cs_attribute | csModuleLinkHash | EXISTENCE | selector |
| cs_attribute | typeReferenceLinkHash | MEANING | the linked ATTRIBUTE_TYPE reference spells the attribute's qualified name, every attribute in Metadata.cs |
| cs_attribute | csExpressionLinkHash | EMPTY BY RULING (pending) | the schema lists the column and never says what an attribute — inert metadata — would name; routed to cs-oracle, asserted empty until ruled |
| cs_block | csTypeLinkHash | MEANING | the WHILE block in `Later.Run` names Later, the second type in Blocks.cs |
| cs_block | csMethodLinkHash | MEANING | a lambda's block is owned by a LAMBDA method row |
| cs_block | csModuleLinkHash | EXISTENCE | selector |
| cs_block | methodOwnerHash | MEANING | the WHILE block in `Later.Run` names Run, the same row as its csMethodLinkHash |
| cs_block | parentContainerHash | MEANING | the block tree: a child's nesting depth is its parent's plus one |
| cs_block | tryStatementHash | MEANING | a CATCH names a block of kind TRY |
| cs_block | conditionExpressionLinkHash | MEANING | a root in the block's own header context (CONDITION / LOOP_HEADER / SWITCH_SUBJECT / LOCK_SUBJECT / USING_RESOURCE), positioned at or above the block; `do` excepted |
| cs_call_site | receiverExpressionLinkHash | MEANING | names the RECEIVER child of its own invocation row (was ABSENT until the second pass) |
| cs_call_site | csExpressionLinkHash | MEANING | 1:1 with expression rows; the linked row's kind and role are read |
| cs_call_site | csModuleLinkHash | EXISTENCE | selector |
| cs_call_site | callerMethodLinkHash | MEANING | the caller is the named lambda / accessor / local function / `<Main>$` |
| cs_call_site | callerTypeLinkHash | MEANING | `Seeded = MakeSeeds()` and `Configured = ComputeDefault()` name the type Kinds, with no method hop; an UNSET hop had passed — the top-level fallback took the module hash in its place |
| cs_comment | ownerHash | MEANING | the doc comment "Does a thing" is owned by `Act`, "A documented type" by `Documented` — the declaration it precedes |
| cs_comment | csModuleLinkHash | EXISTENCE | selector |
| cs_enum_member | csTypeLinkHash | MEANING | `Computed` is filed under Values; nested `Inner`'s `Current` under Inner, not its enclosing Documented |
| cs_enum_member | csModuleLinkHash | EXISTENCE | selector |
| cs_enum_member | csExpressionLinkHash | MEANING | `Computed = Literal \| 2` links to the BINARY root in ENUM_MEMBER_VALUE context owned by Computed; Literal links; Implicit does not (was NEVER WRITTEN — the fifth) |
| cs_event | csTypeLinkHash | MEANING | `Raised` is filed under Generic, the second type in its file |
| cs_expression | expressionOwnerHash | MEANING | a lambda's body rows are owned by the lambda's row; top-level rows by `<Main>$` |
| cs_expression | parentExpressionHash | MEANING | children by role under a named parent; query children parented to the query |
| cs_expression | csTypeLinkHash | MEANING | the condition `inLater < 3` names Later |
| cs_expression | csModuleLinkHash | EXISTENCE | selector |
| cs_expression | referencedEntityHash | MEANING | links to a row of the same NAME; nearest-preceding of two sibling declarations; the captured local and the lambda's own parameter |
| cs_expression | anonymousDeclarationHash | MEANING | resolves to a LAMBDA/ANONYMOUS_METHOD method row, corpus-wide; the curried inner function |
| cs_expression | castTypeReferenceLinkHash | MEANING | the cast pair 1:1 in both directions (was ABSENT until v1.6's lift) |
| cs_field | csTypeLinkHash | MEANING | `Seeded` is filed under Kinds, the second type in its file |
| cs_field | csModuleLinkHash | EXISTENCE | selector |
| cs_field | typeReferenceLinkHash | MEANING | `Needed` links to the FIELD_TYPE reference `string`, `_volatile` to `int`; const fields with a reference counted |
| cs_field | initializerExpressionLinkHash | MEANING | `ConstOne = 1` links to the LITERAL 1, a FIELD_INITIALIZER root owned by ConstOne (was NEVER WRITTEN — the setter existed, nothing called it; found by the promotion) |
| cs_method_parameter | csMethodLinkHash | MEANING | the parameters of a named method, by mode and position |
| cs_method | csModuleLinkHash | EXISTENCE | selector |
| cs_method | csTypeLinkHash | MEANING | a top-level local function is contained by the synthesised Program; `MakeSeeds` is filed under Kinds |
| cs_method | ownerMemberLinkHash | MEANING | accessor 1:1 with a property or event of the matching kind |
| cs_module | csModuleInitMethodLinkHash | MEANING | names the TOP_LEVEL_ENTRY_POINT `<Main>$` itself, not the last method in the file (was ABSENT before v1.6) |
| cs_parse_gap | csModuleLinkHash | MEANING | gap rows per file agree with the parser's own `hasError` per file |
| cs_preproc_region | csModuleLinkHash | MEANING | nine chains in one file, 5 IF + 4 ELSE active |
| cs_preproc_region | parentRegionLinkHash | MEANING | a nested chain's regions name the enclosing IF branch above them |
| cs_property | initializerExpressionLinkHash | MEANING | `Tagged { get; set; } = 7` links to the LITERAL 7, a PROPERTY_INITIALIZER root owned by Tagged (was NEVER WRITTEN, as the field's) |
| cs_property | csTypeLinkHash | MEANING | `Configured` is filed under Kinds |
| cs_query_clause | csExpressionLinkHash | MEANING | the clauses of a named query, parented to it |
| cs_query_clause | parentQueryLinkHash | MEANING | every clause's parent is a QUERY row and the row its csExpressionLinkHash names |
| cs_query_clause | sourceExpressionLinkHash | MEANING | `from x in xs` ranges over the row named `xs` |
| cs_query_clause | bodyExpressionLinkHash | MEANING | `let y = Scale(x)` evaluates the INVOCATION |
| cs_type_heritage | csTypeLinkHash | MEANING | FlipHost's base list under each key; interface-only owners by category |
| cs_type_heritage | csTypeReferenceLinkHash | MEANING | the linked reference's `typeName` equals the entry's `baseTypeName`, every entry |
| cs_type_parameter | ownerLinkHash | MEANING | `TItem` is owned by the TYPE Kinds (second in its file), `Generic<T>`'s `T` by the METHOD Generic |
| cs_type_reference | ownerLinkHash | MEANING | an expression-position reference is owned by an expression row of the matching KIND, per context |
| cs_type_reference | parentReferenceHash | MEANING | `Dictionary<string, List<int>>` keeps its tree shape |
| cs_type_reference | typeParameterLinkHash | MEANING | the linked cs_type_parameter row is named like the reference, every type variable |
| cs_type | declarationGroupKey | MEANING | N parts share one key; the synthesised Program merges with a written one |
| cs_type | csModuleLinkHash | EXISTENCE | selector |
| cs_type | containingTypeLinkHash | MEANING | `D` is contained by C, the enum `Inner` by Documented (not the first type in its file), Documented by nothing |
| cs_using | csModuleLinkHash | EXISTENCE | selector |
| cs_variable | csTypeLinkHash | MEANING | the local `inLater` names Later |
| cs_variable | csMethodLinkHash | MEANING | a lambda's locals belong to the lambda's method row |
| cs_variable | csModuleLinkHash | EXISTENCE | selector |
| cs_variable | csBlockLinkHash | MEANING | `scopeDepth` agrees with the block's `nestingDepth`; the local in a lambda |
| cs_variable | initializerExpressionLinkHash | MEANING | two locals on one line have distinct initializers, read by literal value |
| cs_variable | typeReferenceLinkHash | MEANING | a local's reified generic keeps its type argument |

## The partition, and it sums

| bucket | columns |
|---|---|
| MEANING | 55 |
| EXISTENCE | 11 |
| INTEGRITY | 0 |
| ABSENT | 0 |
| EMPTY BY RULING (pending) | 1 |
| **total** | **67** |

55 + 11 + 0 + 0 + 1 = 67 — counted from the table above by script, not by hand.

## A read is not a check — the sub-class, and its audit

EXISTENCE was ambiguous: "a gate asserts this is populated" and "a gate
touched this column" both landed there, and the second asserts nothing. Both
initializer links were EXISTENCE because a gate read them, and the value it
read was always empty. So the category was audited DIRECTLY, on the data: for
every EXISTENCE and INTEGRITY column, the number of rows on the gate corpus
where the value is non-empty.

Of 31: **28 populated somewhere, 3 always empty** —
`cs_enum_member.csExpressionLinkHash` (declared, documented in the schema,
setter never called: the FIFTH never-written link, now written and asserted
by meaning), `cs_preproc_region.parentRegionLinkHash` (written by the
extractor for nested chains; the gate corpus had no nested `#if` — a fixture
gap, closed), and `cs_attribute.csExpressionLinkHash` (a parity slot the
schema never gave a target — routed). So it was not only the four; it was
five, plus one column that cannot be populated until it is ruled.

The class is closed structurally now: check 34, `every link column is
written`, asserts non-emptiness on at least one gate-corpus row for every
link column, with the parity slot listed by name and reason, so a sixth
never-written link is a named failure the day it is declared.
Before the three absent columns were written: 26 / 30 / 8 / 3.

## What the partition says

**The three ABSENT columns were the actionable ones, and are written now.**
`receiverExpressionLinkHash` was left empty on principle when the receiver
row did not yet exist at call-site time; it is a second-pass fill keyed off
the expression hash — the same pass v1.7 asks for.
`castTypeReferenceLinkHash` is that ruling's cast pair. `csModuleInitMethodLinkHash`
is `<Main>$`.

**The EXISTENCE columns split by risk, and the split was wrong once.** An
earlier version of this paragraph said the `csModuleLinkHash` /
`csTypeLinkHash` owner columns were "asserted by meaning indirectly" because
the per-file gates select by them. The control for register 7 tested that
claim: filing EVERY type's members under the first type in its file — every
`csTypeLinkHash` on every member of every non-first type wrong, resolving —
failed exactly ONE assertion in the suite, the new one. Selection by module
does narrow a gate to a file; selection by type was not happening anywhere,
and a row under the wrong type passed everything. So the four member
`csTypeLinkHash` columns are promoted with `callerTypeLinkHash` (register 7
and 8): one member of each relation, declared in a type that is NOT first in
its file, must be filed under the declaring type by name; the nested enum's
member must be under the nested type and not its enclosing one. The
`csModuleLinkHash` selectors (eleven) stay EXISTENCE with the narrowing they
give named as the reason — a wrong module hash makes a per-file gate find
fewer rows than it expects, which is a check, but only for the files gates
count in.

The register so far, each control pointing the link at a NEIGHBOURING row
that resolves and is wrong: heritage reference, block header, comment owner,
`typeof(X)` argument, field and property initializers, type-parameter link
(1-6); initializer caller type (7 — where an UNSET hop had also passed, the
top-level fallback accepting the module hash); member owner columns (8). The
initializer promotion found that BOTH initializer columns had never been
written — a read is not a check. Registers 9-13 close the rest: the attribute's own type reference (9),
the module's entry point (10), the field's declared type (11), the
attribute's enclosing type (12 — which found the column written as '' for
every member's attribute, against the extractor's own comment; it is the
enclosing type now, the meaning `csTypeLinkHash` has on every other
relation, recorded to cs-oracle as a convention to confirm rather than a
ruling to wait on), and the block / local / expression owner type (13,
with a second type added to Blocks.cs so "the first type in the file" is a
wrong answer there too).

**What remains EXISTENCE is exactly the eleven `csModuleLinkHash`
selectors.** Every gate that scopes to a file scopes by them, so a wrong
module hash makes that file's gate find fewer rows than it expects — for
the files gates count in. A row filed under the wrong module in a file no
gate scopes to would pass; the sufficiency report's per-file agreement with
the parser's own `filesAnalysed` is the corpus-side net for that.

**INTEGRITY is empty.** The five parent/owner pointers that were there
(`parentQueryLinkHash`, `containingTypeLinkHash`, `methodOwnerHash`, the
type-parameter `ownerLinkHash`, the attribute argument's expression link)
are registers 14-18, each asserted by name or by kind. Two of their
controls passed on the first build — the "neighbouring" row chosen was the
row itself (an attribute argument's own tree has one root; the query was
the first expression in its body) — and were rebuilt until they failed:
a control that passes is a control that hasn't been built yet.
`cs_type_reference.ownerLinkHash` was promoted earlier with the
expression-position references.

Each promotion is one assertion that names the expected target; the gate that
found the LINQ defect is the template.
