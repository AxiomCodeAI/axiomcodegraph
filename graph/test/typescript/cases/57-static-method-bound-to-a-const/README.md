# A static method bound to a module const is callable through the const

`const inSorted = Util.inSorted` is the TypeScript spelling of Java's `import static`,
and a mechanical port produces it at every use of a static helper. The binder links a
const to a function expression it is initialised WITH, not to a member it is
initialised FROM, so every call through the const was `ambiguous_unknown` while the
`Util.inSorted(...)` spelling beside it resolved. `viaClass` is the control; `inherited`
reads the static through a subclass; `viaNamespace` binds a function out of an
`import * as` namespace. Every call must be a `known_edge` to the declaration.
