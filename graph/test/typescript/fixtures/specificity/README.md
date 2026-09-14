# Specificity fixture — generic-first overload sets, in both directions

This exists because the obvious fix for the corpus's largest failure is wrong, and a
fixture is the cheapest way to keep it from being written twice.

The failure: 1,272 of the corpus's 3,508 wrong answers have a **type variable** at
parameter 0 in the engine's chosen declaration and a concrete type in the compiler's.
`param_untestable` makes a type-variable parameter unconditionally applicable, and
`overload_beaten` then hands it the win by declaration order. Idiomatic TypeScript
declares generic overloads first, so the always-applicable candidate is also always
first.

The reason a demotion rule cannot fix it is in this fixture, one line above the failing
call:

```ts
render('div')      // the GENERIC overload is the answer
render(widget)     // the CONCRETE overload is the answer
```

Measured on the corpus, that ambiguity is not marginal: a rule preferring the concrete
declaration would gain 1,358 sites and lose 3,831. The constraint-aware version fares no
better — `keyof HTMLElementTagNameMap` appears 1,522 times where demotion would help and
859 times where it would hurt, and on remeda every constraint (`IterableContainer`,
`object`, `string`) appears on both sides. Nothing separates the two populations except
actually evaluating whether the argument satisfies the constraint.

```bash
bash test/typescript/fixtures/specificity/run.sh
```

## The four sets

| set | what it holds | today |
|---|---|---|
| 1 `render` | generic-first, and the answer goes **both ways** | `render('div')` ✓ · `render(widget)` **WRONG** |
| 2 `pick` | same arity, separated only by a constraint that is itself a type variable | agrees with the compiler, on no evidence |
| 3 `pluck` | data-first / data-last — separable by arity and by callability | ✓ |
| 4 `widen` | a lower-indexed candidate that is demonstrably inapplicable | ✓ |

Set 1 is the bug, reproduced from the language rule rather than from any project. Set 4 is
the control that forbids a blanket fix: declaration order genuinely works there, and an
engine that stands down on every overload set loses it.

Set 2 is a **latent** case, not a failing one — the compiler happens to pick the same
declaration the engine does. Its job is to price the remedy: under a stand-down rule set 2
must become a two-way SOUND_SUPERSET, because the engine has no evidence for preferring
either. That is a scored `correct` regression in miniature, and it is the same trade the
corpus shows at scale (1,893 EXACT → SUPERSET against 2,363 WRONG → SUPERSET).

## Why the scoped stand-down does not clear the bar either

`overload_untested` — a survivor the engine kept without positive evidence at some
argument position, because the argument was target-typed or the parameter was a type
variable — was measured before being written. It does not separate the populations:

```
tie-break sites, corpus-wide       EXACT  1,893      WRONG  2,363
  winner VERIFIED                    262 (14%)         193
  winner UNVERIFIED                1,631 (86%)       2,170
```

86% of the exact answers declaration order produces are exact **without evidence** — the
engine had nothing to go on and order happened to agree with the compiler. Order applied to
an unevidenced set agrees with `tsc` 1,631 times out of 3,801, which is 0.43. So a rule that
withdraws order wherever the winner is unverified converts 1,631 correct answers into sets,
and no computable predicate available today does better, because the thing that separates
the two populations is whether the argument satisfies the constraint.

This fixture reproduces that ratio in miniature: 2 exact-at-cost against 1 wrong-gain, all
three unverified. `render('div')` and `render('span')` would become two-way sets under the
scoped rule, which is the trade in its smallest legible form.

## What Java did, and what it costs to buy the same thing

Java's engine (`graph/java/engine/expression-resolution/overload.dl`) hit this and answered
it with `win_fully_applicable`: a candidate may only DOMINATE a rival when it is verified
applicable at every argument position, and where an argument's type is uncaptured no
domination fires and the set is kept whole. Nothing dies by default. Ported to TypeScript
verbatim, that trades 1,637 gains against 1,438 losses — no better than the stricter
predicate, because Java's selector is *most-specific* (a structural order computable from
subtype edges the IR already carries) while TypeScript's is *first-applicable* (a total
order over an exactly-computed applicability predicate). Java's uncertainty is the
language's; TypeScript's is the engine's.

The useful part of the Java precedent is where it put the guard: Java kept the set whole
exactly where `type_ancestor` was incomplete, and let the decidable regimes carry the load.
Asking which regime is incomplete here gives a bounded answer:

```
what blocks verification, by constraint form
  vue-core    keyof <named type>                 2,367   100%
  remeda      a named type / another type var      535    42%
              a generic instantiation              398    31%
              <unconstrained>                      205    16%
```

**One form is all of vue-core.** `keyof X` over an interface with declared members is a
string-literal union, and the IR carries the members — testing it is a lookup, not type
level evaluation. It also resolves both directions of set 1 without a trade:
`render('div')` verifies the generic overload applicable, so order legitimately keeps it;
`render(widget)` proves it INapplicable, so it is pruned and the concrete overload wins.

remeda's residue is the genuinely hard part — a constraint that is itself a type variable
cannot be decided without inference — and that is precisely where Java's keep-the-set-whole
discipline belongs, because there the uncertainty is real rather than a missing capability.

## What a candidate fix has to do here

1. Turn `render(widget)` from WRONG into either exact or a two-way set.
2. Leave `render('div')` exact.
3. Leave sets 3 and 4 exact.
4. Whatever it does to set 2, do it for a stated reason rather than by accident.

A rule that cannot satisfy 1 and 2 simultaneously is a ranking heuristic, and the corpus
already says what those cost.
