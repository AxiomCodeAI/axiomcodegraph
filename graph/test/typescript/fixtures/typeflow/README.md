# Type-flow fixture — every way a receiver gets a type other than being annotated

The dispatch fixture asks what happens once a receiver's type is known. This one asks how
it becomes known at all. Every call site here has a receiver whose type the compiler
*derived* — from a guard, a container, a promise, a callback signature, a getter, a type
parameter, a namespace — and the classes it calls into **share member names on purpose**,
so landing on the right declaration is a question about the type and never about the name.

That last point is the design of the fixture and not a detail. `Alpha.tag`, `Beta.tag` and
`Gamma.tag` are three declarations of one name: an engine with no type flow at all still
answers "which method is called `tag`" perfectly and scores zero here.

Nothing is hand-asserted; `tsc` decides. The comments name the expected declaration for a
human reader and are never read by the harness.

```bash
bash test/typescript/fixtures/typeflow/run.sh
```

## What it measured

```
call sites 139   decidable 120
EXACT 50  0.417     SOUND_SUPERSET 22     WRONG 0     MISSED 48

client/library boundary:  55 client->client, 17 client->library, MISCLASSIFIED 0
call-graph edges:         68 of 116 held   0.586
```

0.417 against the linking fixture's 0.877 and the overload fixture's 1.000. Still zero
wrong targets — the engine does not invent answers, it runs out of them — but this is where
the coverage actually is, and it is a *client-side* gap, reachable without staging a single
dependency.

## The 22 fanned sites: narrowing is not implemented at all

Every guard form in `flow-narrow.ts` fans to every declaration of the member name, in both
branches:

| guard | site | what the engine emits |
|---|---|---|
| `instanceof` | `viaInstanceof` | 3 targets in each branch |
| discriminant `s.kind === 'circle'` | `viaDiscriminant` | 2 targets in each branch |
| `typeof v === 'string'` | `viaTypeofSharedName` | `String.toString` **and** `Number.toString` |
| type predicate `x is Gamma` | `viaPredicate` | 2 targets in each branch |
| `'only_beta' in x` | `viaIn` | 3 targets |
| narrowing undone by assignment | `reassigned` | 3 targets |

Each of those pairs a *narrowed* branch with an *unnarrowed* control (`unnarrowed`,
`viaDiscriminantNamedApart`, `viaTypeof`) that names its members apart, so an engine that
gains narrowing can be shown to have gained it rather than to have gotten luckier.

Two more fans are not narrowing at all and are worth separating:

* **A tuple collapses to the union of its element types.** In `fromTuple`, both
  `pair[0].tag()` and `pair[1].tag()` emit all three declarations, where the compiler gives
  `Alpha.tag` for one and `Beta.tag` for the other. Indexing a tuple by a literal is exact
  information the engine currently discards.
* **Library overload sets the callback's shape should have pruned** — `Promise.all`,
  `Array.filter`, `Array.reduce` each emit two signatures.

## The 48 missed sites, by mechanism

| mechanism | sites | example |
|---|---|---|
| a callback parameter typed by the signature it is passed to | 12 | `items.map((a) => a.tag())` — `a` comes from `Array<T>.map` |
| a generic return type substituted with the inferred argument | 8 | `identity(new Beta()).tag()`, `new Box(g).get().tag()` |
| destructuring — object, array and parameter patterns | 5 | `const { inner } = box; inner.tag()` |
| a namespace member as a receiver | 6 | `Tools.build().tag()`, `Widget.create().render()` |
| a getter's return type as a receiver | 3 | `h.current.tag()` |
| a method used as a value | 3 | `a.tag.bind(a)`, then calling the result |
| a method on an object literal | 2 | `ops.run('x')`, `ops.nested.deeper('y')` |
| `for-of` / `for-await` loop variables | 2 | `for (const b of streamBetas()) b.tag()` |
| a constrained type parameter | 1 | `function tagOf<T extends Alpha>(v: T) { v.tag() }` |
| indexed-access and `typeof` type queries | 2 | `Pair['left']`, `typeof template` |
| conditional / mapped types, `satisfies` | 3 | `Unwrap<Box<Gamma>>`, `{...} satisfies Record<string, Alpha>` |
| an enum member's base type | 1 | `level.toUpperCase()` |

`flow-shape.ts` and `flow-container.ts` account for 28 of the 48 between them.

Two root causes dominate. **Generic substitution** — a type argument inferred at a call is
never propagated into the return type — is the same defect the linking fixture found from
the other side (`first(items).run()` there, `identity(x).tag()` here), which is what makes
it the highest-value fix in the engine: it is not a library problem or a client problem, it
is one missing rule that costs both. **Callback parameter typing** is the same rule seen
once more, since `Array<T>.map`'s callback parameter is `T`.

## What passed

Exactly, with no fan: `Map.get` with its type argument substituted and the non-null
assertion after it, landing on `Beta.tag`; all four segments of the polymorphic-`this`
chain `c.self().step().step().done()`; a cast that changes the answer,
`(a as Gamma).tag()`; a static and an *inherited* static; spread arguments into a rest
parameter; a call through a function-typed parameter, an IIFE, and a
function-returning-function called twice on one line; `Math.max` over const-enum members;
and every constructor call the compiler gives a declaration for.

Sound but deliberately not exact: `await` in an argument position, optional call and
optional member access, and array-element access all recover the receiver correctly and
then fan an `Alpha`-declared receiver to `Alpha.tag` **and** `Gamma.tag`. That is the
dispatch envelope doing its job — `Gamma` overrides `tag` and the declared type admits it —
and it is scored SOUND_SUPERSET rather than counted against the engine.

The instructive pass is the generic class. `new Box(g).get()` resolves to `Box.get`
exactly, and `new Box(b).map(fn)` to `Box.map` — member lookup through a generic class
works. It is only the *return type* of those calls that comes back unsubstituted, which is
why `.get().tag()` on the next segment is a miss. The same split shows on the library side:
`Array.map` and `Array.sort` resolve to the right overload while the callback parameter
they hand back has no type.
