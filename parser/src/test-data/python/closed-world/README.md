# closed-world — a resolution benchmark, not a construct-coverage fixture

**Every callee is declared inside this directory.** No stdlib, no builtins in a
receiver position, no third-party. So the ceiling is exactly **100%**, and any
unresolved call is a parser defect rather than a corpus artifact.

That property is the whole point. Measured on real code, resolution rate mostly
describes what fraction of the callees happen to live inside the analysis root —
`ctypes` scored 7.9% on SELF because 1,303 of its calls target `unittest.TestCase`,
which is outside the root. A number like that says nothing about the parser.

Deliberately excluded, because they make the ceiling unknowable:
`import`s of stdlib modules, builtin calls in a receiver position, `super()` with a
base outside the root, `getattr`/`setattr`.

Each file targets one resolution mechanism, named in its docstring.
