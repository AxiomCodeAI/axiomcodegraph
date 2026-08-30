# Dispatch fixture — an interface-typed receiver and the bodies it can reach

`t1.m1()` where `t1` is an interface has two different right answers, and this fixture
exists to keep them apart.

* **What the compiler says** — `getResolvedSignature` names the SIGNATURE on the
  interface. That is the must-have target, and an engine that misses it is wrong.
* **What can actually run** — every implementation reachable from that receiver. That
  is the dispatch envelope, and an engine that emits something OUTSIDE it is wrong in
  the other direction.

The fixture supplies both by construction:

| case | receiver | what must happen |
|---|---|---|
| 1 | `h: Handler` parameter | fan to the nominal implementations |
| 2 | `new UpperHandler()` | EXACT — one target. A fan here is a defect, not imprecision |
| 3 | `const h: Handler = new LowerHandler()` | flow beats the declaration; one body |
| 4 | `const h: Handler = new SilentHandler()` | SilentHandler declares no `implements` |
| 5 | `p: Probe` parameter | NOTHING declares itself a Probe — structural only |
| 6 | `n: Node` abstract base | fan to the subclass overrides |
| 7 | `l: LeafNode` with a subclass | a class receiver still fans to its subclass |
| — | `super.describe()` in `inherit.ts` | non-virtual: exactly one target, never the override |

`NeverBuiltHandler` is declared and never constructed: it is inside the CHA envelope
and outside RTA, so a harness that reports the two separately can be checked here.

```bash
bash test/typescript/fixtures/dispatch/run.sh
```
