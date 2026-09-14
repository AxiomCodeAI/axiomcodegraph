# A chained receiver is typed from the arity-applicable overload

`String name()` and `Item name(String)` on one class. The chained receiver of
`item.name().equals(x)` was typed from every same-name candidate, so it was String OR
Item, and the site resolved to `Item.equals` as a known_edge: a client method that never
runs, whose blast radius covers every `String.equals` in the codebase. `viaZeroArg` must
not reach `Item.equals`; `viaOneArg` and `viaSelf` must.
