# Overload fixture — cross-file, hostile declaration order

A small project whose only purpose is to make overload resolution decidable and then
check it. Every overload set is declared in one file and called from two others: once
through a barrel re-export, once by direct import. If the two consumers score
differently, the difference is the module graph and not the overload logic — which is
the only way to tell those two failures apart.

The declaration order is deliberately hostile. In `scale`, `pad`, `area`, `Registry`
and `format` the answer for the most ordinary argument is a NON-FIRST declaration, so
an engine that takes declaration 0 scores near zero here while looking respectable on
a name-level comparison.

Nothing in this directory is hand-asserted. `tsc` decides which signature each call
resolves to; the fixture only supplies the source. The comments name the expected
declaration for a human reader and are never read by the harness.

```bash
bash test/typescript/fixtures/overloads/run.sh
```

## The five mechanisms it covers

| file | what separates the overloads |
|---|---|
| `math.ts` `scale` | PRIMITIVE parameter type — string vs number vs boolean |
| `math.ts` `pad` | ARITY alone, 1 / 2 / 3 |
| `shapes.ts` `area` | NAMED OBJECT TYPE — two interfaces with no shared member |
| `registry.ts` | overloaded class METHOD and overloaded CONSTRUCTOR |
| `callable.ts` | overloaded CALL SIGNATURES on an interface, and CONSTRUCT SIGNATURES |

`registry.ts` also imports its parameter types from `shapes.ts`, so resolving
`reg.add(circle)` needs the argument's type resolved across a file boundary before the
overload set can be compared at all.
