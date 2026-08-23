# Build broken — 7 type errors in `python-resolution-linker.ts`

`npm run build` fails. Everything else compiles; these seven are all in one file
and all look like one refactor left half-applied. They need the author's intent,
which is why they are described here rather than guessed at.

## The four that matter

**`exportsByModule` disagrees with itself.** Built at line 197 as
`Map<string, Map<string, PyMethodRegistry | PyTypeRegistry | null>>` — the `null`
is meaningful, recording a name that is exported but unresolvable, which is not
the same as absent. Two consumers declare it without the `null`: `followReExport`
(1601) and the context object at 1982. Widening only those two makes the count
rise to 11, so the null-ness flows further than it looks and the right fix is a
decision about where it should stop.

**`fieldsByTypeAndName` vs `fieldByTypeAndName`** at 1908. Two different things —
plural is `Map<string, PyFieldRegistry[]>`, singular is `Map<string, PyFieldRegistry>`
— and the plural is being passed into a slot expecting the singular.

**`MroContext` is missing `methodsByTypeAndName`** at 2694 and 2742. The context
objects built there predate the field being added to the interface.

**`typeOfLocalReceiver`** at 2279 wants `bindingByScopeAndName` and `parentScopeOf`,
neither of which the caller supplies.

**`hasEscapeHatch`** at 3306 is dead. Delete it or wire it up.

## What was already fixed

21 of the original 28, all mechanical:

- `PythonModuleExtraction.positions` and `PythonDeclarationExtraction.typePositions`
  were assigned and read but never declared on their interfaces
- `PythonFieldExtraction.fieldTypePositions` likewise
- `emitLambdaParameters` referenced a `context` parameter it does not have. Python
  forbids annotations on lambda parameters, so that branch is unreachable — which
  is why a compile error sat there unnoticed
- `PythonEdgeRole.PARAMETER_DEFAULT` does not exist; the enum has `DEFAULT_VALUE`
- module-level `visitStatements` omitted `directClassMember`
- `blocks` belongs on the returned `PythonFactSet`, not on `ResolutionInput`
- a missing `PythonScopeKind` import, two unused locals, one stale type name

## How this went unnoticed

`tsx` transpiles without typechecking, so the test suite ran green over a tree
that could not build — for at least a dozen commits. `npx tsx src/test/python-tests.ts`
now runs `tsc --noEmit` as its first check, before anything else, because every
result after it is meaningless otherwise.
