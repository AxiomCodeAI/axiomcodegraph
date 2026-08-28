# Measured accuracy, four projects

Every number below comes from `test/typescript/run-evaluation.sh`, which extracts the
IR, discovers and stages the libraries, solves, runs the compiler as an oracle, and
scores — in one pass, with no hand-staging and no per-project tuning. Re-runnable:

```bash
bash test/typescript/run-evaluation.sh <project-dir> <work-dir>
```

**Engine revision:** this branch. **Parser revision:** `Parser@b26271a`, rebuilt
immediately before the run. **Oracle:** `checker.getResolvedSignature`, the project's
own `typescript`, out of process.

---

## The headline

| project | call sites | oracle sites | decidable | **EXACT** | in engine set | WRONG | envelope precision |
|---|---|---|---|---|---|---|---|
| AxiomCode Parser (418 modules) | 14,090 | 14,090 | 14,007 | **0.806** | 0.896 | 123 | 0.956 |
| remeda (531 modules) | 23,011 | 23,011 | 8,042 | **0.812** | 0.850 | 572 | 0.971 |
| zustand (37 modules, React + vitest) | 4,200 | 4,346 | 4,176 | **0.475** | 0.516 | 14 | 0.958 |
| this repository | 84 | 84 | 84 | **0.786** | 0.893 | 1 | 0.879 |

* **EXACT** — the engine named ONE target and it is the declaration the compiler
  selected. Position-precise, so picking a different overload of the same function
  counts as a miss, not a pass.
* **in engine set** — EXACT plus SOUND_SUPERSET: the compiler's target is among
  several the engine emitted.
* **WRONG** — the engine named targets and the compiler's is not among them. The one
  bucket that is a defect rather than imprecision.
* **envelope precision** — the share of emitted edges inside the CHA dispatch envelope
  computed with `isTypeAssignableTo`. An edge outside it is a demonstrable false
  positive, not an over-approximation.

Scoring is **per call site**, not per edge: a twelve-way dispatch set is one site a
reader cannot trust, not one agreement and eleven over-approximations.

---

## The site universes agree exactly

| project | parser IR | `getResolvedSignature` | joined on span |
|---|---|---|---|
| AxiomCode Parser | 14,090 | 14,090 | 14,090 |
| remeda | 23,011 | 23,011 | 23,011 |
| this repository | 84 | 84 | 84 |
| zustand | 4,200 | 4,346 | 4,200 |

Two independent toolchains finding the identical set of call sites, joined on exact
source spans, is the strongest evidence a conservation contract can have — and it is
what makes the accuracy figures mean anything at all.

zustand is the one divergence and its cause is known and single: **144 JSX component
calls the parser does not emit** (PARSER-DEFECTS.md, PD-TS-1) plus 2 index calls.
Nothing else, on any project, differs.

---

## Reading zustand's 0.475

It is the lowest number here and it is the most informative one.

zustand is 37 modules of deliberately extreme TypeScript — a store library whose
public surface is `type Create = { <T, Mos>(initializer): UseBoundStore<Mutate<S, Mos>> }`
— plus a test suite written against vitest, React and testing-library. Its remaining
2,007 missed sites are almost entirely two populations:

* **generic inference through a callback and through a conditional type.**
  `create(...)` returns `UseBoundStore<Mutate<StoreApi<T>, Mos>>`, and the type of
  `useBoundStore.getState()` is only knowable by instantiating a conditional type.
  The engine substitutes type ARGUMENTS (`generics.dl`) and does not do INFERENCE;
  guessing there would fabricate rather than over-approximate, so those sites stay
  unresolved and countable.
* **JSX**, absent from the IR entirely.

WRONG is **14** of 4,176. The engine is not wrong about zustand; it declines to answer, which is
the failure mode a call graph can survive.

---

## Reading remeda's 14,936 synthesized

remeda's decidable set is 8,042 of 23,011 because `getResolvedSignature` returns a
signature with **no declaration** for 14,936 sites — its data-last curried API means
most calls resolve to a synthesized instantiation rather than a written declaration.
Those are excluded from the denominator on both sides: the oracle has nothing to point
at, so neither engine nor score can be right or wrong about them.

Its 572 WRONG are overload selection inside one function — `add.ts:32` where the
compiler chose `add.ts:33`. The envelope, which counts an overload of the same
function as a dispatch possibility rather than a wrong target, puts precision at
**0.971**.

---

## What moved the numbers

Each of these was found by measurement, not by reading rules, and each is recorded
where it was fixed:

| change | effect |
|---|---|
| library-side type resolution (`lib-scope.dl`) | 0.588 → 0.735 on the Parser corpus. `console` had no members, `Set` had no constructor, `path.join` did not exist |
| the property name is on the child, not the node | +1,356 sites. `this.rows.push(x)` had no receiver type |
| `export = ns` exposes the namespace's members | the entire TypeScript compiler API became reachable |
| `for (const x of xs)` binding typing | 1,055 of 6,251 client variables were untyped |
| staging only the lib files the program loads | 0.686 → 0.737 on the Parser corpus, WRONG 384 → 115. Staging all of them put DOM globals into a Node project |
| staging the libraries' own dependencies, one round | zustand 0.209 → 0.460 (0.475 after the later fixes). `it` and `describe` live in `@vitest/runner`, which the client never imports |
| namespace members must NOT be global | zustand WRONG 97 → 5. `Reflect.set` was answering every bare `set(...)` |
| primitives compared by NAME | remeda's `bigint`/`number` overloads were indistinguishable when `lib.es2020.bigint` was not staged |
| barrel longest-match taken over MATCHING candidates | 0.737 → 0.778 on the Parser corpus. The longest tail of `@/a/b/C` is the whole specifier, which the alias prefix guarantees will never match, so the rule derived nothing while looking correct. `export_specifier_unresolved` 181 → 0 |
| an arrow function must be SELECTABLE | 0.778 → 0.806. Every arrow carries signatureRole = IMPLEMENTATION and an EMPTY declarationGroupKey — 955 of them here — so the overload-selection rule could not fire for any, and `const fail = (m) => …; fail(x)` resolved to nothing |
| the implicit `Object` base | `x.toString()` found no member on a perfectly typed receiver: no type declares `extends Object` and nothing in the IR does either. 101 sites, all reported as `member_absent`, which was the right diagnosis |

---

## Client → library navigation

The question this was built to answer — *given the IR of a dependency, do we know
exactly where to go* — is `client-to-lib-navigation.csv`: one row per boundary edge
with the package or specifier, the file and the line.

Measured on the Parser repository, **8,929 client→library edges** at the time of that reading, for example:

```
src/parsers/typescript/.../ts-binder.ts:404  isStringLiteral()  ->  typescript.d.ts:8966
src/parsers/gradle/.../gradle-file-extractor.ts:562  has()      ->  lib.es2015.collection.d.ts:38
src/parsers/python/.../python-symbol-table.ts:291   delete()    ->  lib.es2015.collection.d.ts:103
src/language-detectors/python-detector.ts:50        some()      ->  lib.es5.d.ts:1456
```

`lib_boundary_reason` says why each chain stopped — `ambient_no_body` (there is no
TypeScript body to find), `signature_dispatch` (look in an implementation),
`lib_body_available` (the body is staged and expandable).
