# Every control, on one axis: non-vacuity or originating-defect

cs-fixtures measured check 36 (spans nest) at CS-CORPUS-22's own commit: 0
violations before the fix and 0 after. Its two containment controls prove the
gate is not vacuous — they mutate a CORRECT emission until a child escapes —
and say nothing about whether the gate fires on the defect it was derived
from. Both are true; they are different facts, and a gate with only the first
kind of control can be derived from a defect it cannot see.

So every control in `negative-controls.sh` is classified here, on the taxonomy
cs-corpus and cs-impl now share (three buckets, not two):

- **originating-defect** — the mutation re-applies a defect that was FOUND: a
  corpus finding, an adjudication, a measured loss, a never-written column.
  The evidence column names it.
- **non-vacuity** — the mutation is of a correct emission, chosen to make the
  gate fail. It proves the gate can fail; it does not prove the gate sees the
  thing it was written for.
- **fired-but-misclassified** — cs-corpus's third bucket, which neither of us
  had: its gate-ifdef SAW CS-CORPUS-25's inverted regions and filed them as
  CONFIG-DISAGREE. Such a check passes non-vacuity AND fires on its originating
  defect and is still wrong. In this harness the shape is a gate that fails
  under a re-applied defect for some OTHER reason than that defect. The
  instrument for it is `run_break`'s optional fifth argument: a fragment the
  named gate's failure text must contain. With a fragment, OK means "failed,
  and said why"; a gate that failed without saying it is counted
  `MISCLASSIFIED`, a fourth number on the tally line, and the release gate
  requires it to be 0. Five originating-defect controls carry a fragment now
  (CS-CORPUS-21, 22, 24, 25 ×2); the path was shown to fire with a throwaway
  control whose fragment matched nothing. The other originating-defect
  controls have no fragment yet, and for them OK still means only "fired" —
  the table's evidence column says which finding each should name when its
  fragment is added.

The classification is by label, comment and the history I hold; where a
control's origin was not a recorded finding it is filed as non-vacuity, the
weaker claim. An originating-defect entry whose evidence names a finding can be
checked against that finding; one that names only my memory is a claim I am
making, and says so.

| control | axis | evidence |
|---|---|---|
| descend into INACTIVE #if branches | originating-defect | six walks were found descending into both branches after the statement walker was fixed |
| drop ARITY from the declaration group key | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| drop the FILE from a file-local type's scope key | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| key cs_type on name and arity alone | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| point containingTypeLinkHash at a hash nothing declares | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| make one column non-deterministic | originating-defect | the determinism check was shown vacuous once |
| drop a column from cs_type's toCsv | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| emit a kind that is not a declared enum member | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| classify a record struct as a reference type | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| stop honouring the pinned grammar regime | originating-defect | the harness reported a mutation to the regime passed 12/12 before the literal was frozen |
| drop targetFramework from the module key | originating-defect | §2.2 option 3: two frameworks collided on one module hash |
| lose the implicit framework symbol table | originating-defect | NET8_0_OR_GREATER is in no file anywhere |
| report a struct base list as BASE_OR_INTERFACE | originating-defect | a struct's base list is interfaces only; it was reported ambiguous |
| read variance from modifier nodes only | originating-defect | `in TIn` / `out TOut` produced no variance until the read was widened |
| match where-clauses positionally instead of by name | originating-defect | constraints matched by position attached to the wrong parameter |
| count unmanaged as a TYPE constraint | originating-defect | the harness reported that removing the guard changed nothing; the guard was dead until `unmanaged` was in a fixture |
| emit the base argument_list as a heritage entry | originating-defect | CS-CORPUS-6: `Parent(X)` emitted as a base type name |
| read only the FLAT primary-constructor base shape | originating-defect | CS-CORPUS-6: the record shape produced baseTypeName='Parent(X)' |
| treat every class base entry as ambiguous | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| declare a grammar read the grammar does not have | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| make defineConstantsKey order-dependent | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| lower-case preprocessor symbols before hashing | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| emit two cs_method rows for one accessor | originating-defect | a property emitted its accessors on two paths; duplicates double |
| drop the owner link from an accessor | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| call a field-like event one with accessors | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| lose the getter of an expression-bodied property | originating-defect | `int X => _x;` emitted no accessor |
| fold init into set | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| default an interface member to private | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| give an explicit interface impl an accessibility | originating-defect | `void IFoo.Bar()` was reported private |
| read only the parameter children, dropping params | originating-defect | `params int[] d` was dropped by a read of `parameter` children only |
| read scoped only from the modifier list | originating-defect | `scoped ref int g` lost its scoped |
| compare parameter children by object identity again | originating-defect | the `===` wrapper-identity comparison cost a column (cs-node.ts header) |
| miss the ref in a ref return | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| stop emitting local functions | originating-defect | local functions had no rows |
| take every accessor_declaration, including inactive #if branches | originating-defect | accessors from the untaken branch were emitted |
| flatten the type-reference tree | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| read generic arity off the OUTERMOST qualified name | originating-defect | one reader read arity off the last segment and the others did not; qualified generics reported arity 0 |
| count array brackets instead of commas plus one | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| give a tuple no element children | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| wrap a nullable type instead of flagging it | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| read dynamic as an ordinary named type | originating-defect | `dynamic` was a named type until reserved (INDEX_CALL precedent) |
| treat a type variable as a type name | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| lose usings written inside a block namespace | originating-defect | usings inside a block namespace were lost |
| take usings from inactive #if branches | originating-defect | the untaken-branch defect, on usings |
| point an implicit using at line 1 | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| fold 'using static' into a plain namespace using | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| descend into a maximal ERROR node | originating-defect | parse gaps were counted per nested ERROR; duplicates doubled the gap count |
| walk only named children, so MISSING is unreachable | originating-defect | MISSING nodes are anonymous and were never seen |
| file preprocessor debris as an ordinary grammar error | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| count module parse errors separately from the gap rows | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| drop the fallback for files with no locatable error | originating-defect | GapUnlocatable.cs: hasError with no ERROR node produced no gap row |
| trust isMissing instead of zero width | originating-defect | GapZeroWidth.cs |
| emit one row per field DECLARATION, not per declarator | originating-defect | `int a, b;` was one field |
| emit a type reference per declarator | originating-defect | `int a, b;` doubled the reference count |
| forget that const is implicitly static | originating-defect | const fields reported isStatic=false |
| fold a COMPUTED enum value into a literal | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| call every initialised enum member a literal | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| bucket a self-reporting node as an ordinary error | originating-defect | one multitarget-B test file's whole defect was a preproc_pragma node |
| keep the verbatim @ prefix on an identifier | originating-defect | `@async` kept its @ |
| leave Unicode escapes undecoded | originating-defect | identifier normalisation finding |
| stop stripping type arguments from the base name | originating-defect | baseTypeName carried `<T>`; three readers drifted |
| normalise with NFKC instead of NFC | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| count nested commas as top-level type arguments | originating-defect | `Dictionary<string, List<int>>` reported arity 3 |
| leave a leading scoped/ref on the base type name | originating-defect | `scoped ref T` in a base name |
| skip parenthesised expressions instead of emitting them | originating-defect | §6: a wrapper that emits nothing takes its subtree; `(a.B())` lost the call |
| drop the assignment target/value roles | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| call an event subscription a compound assignment | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| guess a method group from position alone | originating-defect | 2,080 identifiers became method groups on one stratum |
| put the operator in the kind instead of a column | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| walk a lambda body with the enclosing method as owner | originating-defect | lambda bodies were owned by the enclosing method; a lambda's locals belonged to the wrong method (the label appears twice, once per gate) |
| look for a local initializer in the wrong wrapper | originating-defect | local initializers under equals_value_clause were missed |
| count out arguments as ordinary ones | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| emit a query with no clause rows | originating-defect | LINQ query syntax emitted nothing per clause (cs-oracle ruling) |
| leave the clause expressions unparented | originating-defect | clause expressions were roots, not children of the query |
| drop the clause source and body links | originating-defect | `from x in xs` ranged over x and filed xs as its body — the LINQ finding |
| give a clause an arbitrary position | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| drop the this-parameter marker | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| read orderby direction from the whole clause | originating-defect | one flag on the clause was wrong about the other key |
| treat an ordering key as a range variable | originating-defect | orderby reported a range variable it does not bind |
| misname foreach in the statement walker | originating-defect | the walker named for_each_statement where the grammar says foreach_statement |
| stop descending into unrecognised statements | originating-defect | an unrecognised statement swallowed its expressions |
| pick a lambda body positionally instead of by field | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| stop walking accessor bodies | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| read a pattern's designation positionally instead of by field | originating-defect | tuple_pattern replaced the name, so the positional read was null |
| collect only statement declarations, not expression ones | originating-defect | five of the nine declaration kinds bind inside an expression and had no rows |
| drop the deconstruction index | originating-defect | `(var a, var b)` bindings were indistinguishable |
| fold ref into the type name instead of a column | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| lose the scoped lifetime constraint | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| let the generic block rule relabel the method body scope | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| treat both if branches as one block | originating-defect | ELSE was not a block |
| key the expression side table on the line instead of the node | originating-defect | two locals on one line shared an initializer expression |
| read checked and unchecked as the same block | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| drop the label from a labelled statement | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| forget which try a catch guards | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| drop the caught type names | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| walk a lambda body with the enclosing method as owner | originating-defect | lambda bodies were owned by the enclosing method; a lambda's locals belonged to the wrong method (the label appears twice, once per gate) |
| stop walking local function bodies | originating-defect | a local function's row and parameters were emitted and every expression inside it dropped (§6) |
| write var as a type name | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| lose the initializer expression link | originating-defect | the initializer link was empty |
| lose the block condition link | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| erase the type argument of a local's reified generic | originating-defect | C# generics are reified; `List<int>` lost `int` |
| reach a nested tuple pattern twice | originating-defect | a nested tuple pattern was flattened by its parent AND visited on its own path — doubled |
| read every declaration_expression as an out var | originating-defect | a declaration_expression inside a tuple is a deconstruction; it was OUT_VAR |
| push a null-conditional callee whole as the method name | originating-defect | `a?.M()` had no RECEIVER |
| read an assignment's operands by position | originating-defect | `x = this` dropped its value — `this` is anonymous |
| leave the lambda expression row unlinked from its method row | originating-defect | 0 of 99,529 lambda rows on one stratum carried the link |
| miss a lambda that is the whole initializer | originating-defect | a bare initializer lambda had no method row |
| never resolve a reference to its declaration row | originating-defect | referencedEntityHash was never written |
| resolve a reference to the FIRST declaration of its name instead of the nearest preceding | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| count a query clause's declared name as its first expression | originating-defect | LINQ clause links pointed one child left |
| declare no range variable for an into continuation | originating-defect | `into h` had no variable |
| rebuild a heritage row without its type-reference link | originating-defect | withPrimaryConstructorArguments dropped the type-reference link |
| skip the local functions declared in an accessor body | originating-defect | `Create()` declared in a getter was called as LOCAL_FUNCTION_CALL and declared nowhere |
| miss the inner function of a curried lambda | originating-defect | the curried inner lambda had no method row |
| label an as-expression's type CAST | originating-defect | cs-oracle: `as T` IS NOT CAST |
| forget the cast's forward link to its type reference | originating-defect | castTypeReferenceLinkHash was ABSENT until v1.6's lift |
| emit the method type arguments under the enclosing method instead of the call | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| leave the receiver link on the call site empty | originating-defect | receiverExpressionLinkHash was ABSENT until the second pass |
| emit no type for a typed lambda parameter | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| give attribute-argument expressions no type-reference sink | originating-defect | 1,777 of 32,432 casts on one stratum had no pair |
| cut a fixture short | originating-defect | the backtick — nine recurrences |
| write every fixture to disk two lines short of the text the suite holds | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| hand a constructor initializer itself back as its argument list | originating-defect | CS-CORPUS-19: 455 calls, the regression the CS-CORPUS-6 fix introduced |
| link a heritage entry to the previous entry's type reference | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| link a block to the first expression root in its body instead of its header | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| own a comment by the declaration AFTER the one it precedes | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| classify a bare member name ahead of the local that shadows it | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| classify the name half of x.Foo as a member of the enclosing type | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| leave a member reference unlinked from its row | originating-defect | v1.8 FIELD/PROPERTY/EVENT links were absent |
| link a typeof attribute argument to the attribute's own type reference | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| link every type variable to the first type parameter in scope | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| leave a field's initializer link unset | originating-defect | never written — the setter existed, nothing called it |
| link a property's initializer to a neighbouring field's row | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| leave the type hop off a call with no enclosing method | originating-defect | an unset hop passed: the top-level fallback took the module hash |
| file every type's members under the first type in the file | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| file a nested type's members under its enclosing type | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| link every attribute to the first type reference in the file | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| point the module's entry-point hop at the last method in the file | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| link a field's type to the previous field's type reference | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| file a nested type's attributes under the outer type | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| write no type link for a member's attributes | originating-defect | the code wrote '' for every member's attribute, against its own comment |
| file every type's blocks and locals under the first type in the file | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| own every type parameter by the first type in the file | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| own a nested block by its parent block instead of its method | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| parent every query clause to the first expression in the body | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| link an attribute argument to the last expression of its own tree | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| contain a nested type in its grandparent | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| ignore a file-level #define | originating-defect | CS-CORPUS-25 |
| ignore a file-level #undef | originating-defect | CS-CORPUS-25 |
| file a directive that follows #else under the #if branch | originating-defect | found fixing CS-CORPUS-25: the chain defined both symbols |
| honour the #define in the first branch of a top-of-file chain whether or not it is taken | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| give a with-initializer no expression kind | originating-defect | CS-CORPUS-21 |
| swap a with-initializer's target and value | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| keep #pragma as a named child of the expression it sits in | originating-defect | CS-CORPUS-24 |
| compile the gate corpus under a different target framework | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| compile the gate corpus with a define the pins do not know | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| end an expression at its type field | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| end a creation at its type name, as the mis-parse did | originating-defect | CS-CORPUS-22 — PARTIAL: the extractor is made to emit the bad parse's span; the CAST parent the bad parse invented cannot be produced without the fork6 grammar, and that half is evidenced by cs-fixtures' measurement (5 sites → 0), outside the harness |
| end a block at its first statement | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| leave the enum member's value link unset | originating-defect | never written — the fifth |
| write no parent for a nested preproc region | originating-defect | parentRegionLinkHash was empty on the gate corpus (a fixture gap) |
| drop the C# parser from the factory | originating-defect | registration was absent until e356f9a |
| drop the C# detector from the project detector | originating-defect | registration was absent until e356f9a |
| make the C# detector claim any ancestor that contains C# | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| dispatch no C# project from the entry point | originating-defect | registration was absent until e356f9a |
| own top-level blocks and locals by nothing | originating-defect | v1.6 §4.0.3: MODULE_INIT owned them |
| own top-level expressions by nothing | originating-defect | v1.6 §4.0.3 |
| synthesise no Program type for a top-level file | originating-defect | v1.6 §4.0.3 |
| give the synthesised Program its own group key | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| stop walking top-level statements | originating-defect | top-level statements had no owner and no rows |
| read a named argument's value positionally | originating-defect | `M(label: Scale(n))` pushed `label` and dropped the call |
| let a comment shift a positional child index | originating-defect | a comment before a positional child shifted every index after it |
| drop array creations from the expression allowlist | originating-defect | 185 of 5,324 call sites on multitarget-A: array_creation_expression emitted no row |
| fold a null-conditional call into an ordinary method call | originating-defect | `a?.M()` classified as a plain call |
| bind a local for an out-discard | non-vacuity | a mutation of a correct emission; proves the gate is not vacuous |
| resolve body #if against an empty symbol set | originating-defect | body #if evaluated without the configuration's symbols |
| descend into every #if branch when walking blocks | originating-defect | the untaken branch's blocks were emitted |
| take the last #if branch instead of the first matching one | originating-defect | elif chains took the last matching branch |
| read a callee positionally instead of by field | originating-defect | the callee at position 0 was wrong for conditional access |
| classify every bare-name call as a delegate invoke | originating-defect | cs-oracle adjudication: a lookup miss is don't-know, not DELEGATE_INVOKE |
| never recognise a local function call | originating-defect | cs-oracle adjudication: LOCAL_FUNCTION_CALL |
| collect lambdas from every #if branch | originating-defect | a lambda in the untaken branch got a method row |
| find a yield in the untaken branch | originating-defect | `M` reported isIterator from a yield that is not in the program |
| always take the first #if branch | originating-defect | branch selection took the first branch |
| parse a file past the ceiling without the callback | originating-defect | the 32,767-character limit; three of five Python stdlib packages failed without it |
| pin the pragma fixture's last byte to a newline | originating-defect | GapUnlocatable.cs's last byte is the finding |
| walk the whole body once per statement root | originating-defect | the walk was quadratic in statements per body |
| let a delegate lookup miss fall through to DELEGATE_INVOKE | originating-defect | cs-oracle adjudication: a lookup miss is don't-know |
| read a type's base list without looking through a #if | originating-defect | CS-CORPUS-17: fork rule 1 |
| read a callable's body without looking through a #if | originating-defect | CS-CORPUS-15: fork rule 2 |
| read a property's accessors without looking through a #if | originating-defect | fork rule 6 |
| hide the enclosing scope's local functions from a local function body | originating-defect | CS-CORPUS-18's cause: nested callables did not inherit the scope at their declaration |
| ignore a single-parameter lambda's parameter | originating-defect | `x => x.Length`'s x was not a parameter |
| make a local function visible from every block in the body, not its own | originating-defect | block-scoped local-function names |
| walk a lambda body with an empty enclosing scope | originating-defect | CS-CORPUS-18: a captured local looked like a method |
| emit a primary constructor's base arguments without the invocation | originating-defect | a primary-constructor base invocation had no BASE_CONSTRUCTOR_CALL |
| read the record base invocation's callee as the wrapper's text | originating-defect | CS-CORPUS-6: `Parent(X)` as the callee |
| give each top-level statement a fresh locals scope | originating-defect | `scale(3)` at top level was FUNCTION_CALL; the local from the previous statement was invisible |

## The split, and it sums

| axis | controls |
|---|---|
| originating-defect | 120 |
| non-vacuity | 78 |
| **total** | **198** |

120 + 78 = 198 — the number of `run_break` calls in the harness, counted by script
(`grep -c '^run_break "' negative-controls.sh`).

## The sibling: a control detached from its target

A control names a construct; when the construct is refactored away the
mutation applies to nothing and the control reports OK forever — not a wrong
fragment, an ABSENT target. The base-name control detached at f46b4fd and
was found three commits later, at control 108 of a full tally the machine
then killed. Check 37, `every control applies`, applies every patch in the
harness in memory to the file it names, in 0.3 s, on every suite run; a
detached control is a named failure the same commit it detaches. Shown able
to fire by re-detaching that control.

## What the split says

The non-vacuity controls are concentrated where a gate was written FROM a
ruling or a register entry rather than from a corpus miss: the link-column
promotions (each pointing a link at a neighbouring row), the containment check,
the program pins, the PK / FK / determinism shape gates. Those gates are real
invariants; what their controls do not show is that the invariant would have
caught the defect that motivated it — for check 36, cs-fixtures showed it would
not have. Where the motivating defect has evidence outside the harness (the
5 → 0 measurement for the two CS-CORPUS-22 invariants), the evidence column
says where. A gate whose only controls are non-vacuity is the next place to
look when a sweep returns a miss the suite was supposed to own.
