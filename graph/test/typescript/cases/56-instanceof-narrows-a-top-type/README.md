# `instanceof` narrows a top-typed subject

A subject declared `unknown`, `object` or `any` has no members, so a call inside an
`instanceof` branch resolved to nothing, while the same call on a `Node | string`
subject resolved (not by narrowing: the fan over the union's members happens to
contain `Node`). The tested class is now given to a top-typed parameter or variable
throughout its function, flow-insensitively, which can only add a target where there
was none. `fromUnion` and `fromNullable` are the controls that already resolved;
`guardedEarly` is the negated-guard spelling, `fromVariable` the `const` subject.
Every `outerHtml()` must be a `known_edge` to `Node.outerHtml`.
