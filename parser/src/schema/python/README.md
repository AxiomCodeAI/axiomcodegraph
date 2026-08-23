# Python fact schema — the contract

| file | what it is |
|---|---|
| `PYTHON-FACT-SCHEMA.md` | **the frozen schema.** 19 relations, every column, every FK edge |
| `decls_base_py.dl` | Souffle base relations, **generated — never hand-edit** |
| `gen_decls.py` | generates the `.dl` and guards doc/code agreement |
| `FIELD-CLASSIFICATION-SPEC.md` | decision procedure for the fields CPython cannot adjudicate |
| `TYPE-REFERENCE-CONTEXT-SPEC.md` | the `py_type_reference.context` enum, case by case |

    python3 src/schema/python/gen_decls.py            # regenerate the .dl
    python3 src/schema/python/gen_decls.py --check    # CI: refuse drift

`--check` enforces three things, and each exists because it was missed once:

- **arity** — the header count against the actual column rows
- **enum membership**, both directions. `ELEMENT` shipped while the doc still
  listed 42 edge roles, and arity never moved, so the guard stayed green.
- **that an enum's column exists**. A `kind` enum was documented for
  `py_type_parameter`, which has no `kind` column; membership agreed with a real
  TypeScript enum and passed. Agreement is worthless if the column is imaginary.

Column order is the contract. All columns are `symbol`. New columns append only;
the last column is the entity's own hash and `serviceVersionLinkHash` sits
immediately before it.
