"""Reduction: a comprehension walrus at MODULE scope binds a GLOBAL.

Mined from black/tests/data/cases/pep_572_py39.py:4, pep_572.py:8,
pep_572_py310.py:8, preview_redundant_generator_parentheses.py:12,57.

    {x4 := i ** 5 for i in range(7)}      # at module level

A walrus inside a comprehension binds in the ENCLOSING scope.  When that
enclosing scope is the module, CPython makes it a GLOBAL declaration -- there
is no enclosing function to hold a cell -- and records it in both symbol
tables that way.

CPython 3.10.4 symtable
    module block, x4:        is_global=1 is_declared_global=1  -> 00100000100
    comprehension block, x4: is_global=1 is_assigned=1
                             is_declared_global=1              -> 00100010100
A3 @ b800789
    module block, x4:        is_local=1 is_global=1 is_assigned=1 -> 01100010000
    comprehension block, x4: is_nonlocal=1 is_free=1 is_assigned=1 -> 00011010000

Same root as a4-028, but this one needs NO `global` statement: it is the
default at module scope, so every module-level comprehension containing a
walrus hits it.  Four of eleven predicates differ, in both scopes, and the two
answers disagree about whether the name lives in the module namespace or in a
(nonexistent) enclosing cell.
"""

squares = {x4 := i ** 5 for i in range(7)}
doubles = [y := n * 2 for n in range(3)]
total = sum(z := k for k in range(4))


def inside_a_function():
    # for contrast: here the enclosing scope IS a function, so the walrus
    # target is a local of that function and a free variable of the
    # comprehension -- both sides already agree on this case.
    values = [w := m for m in range(3)]
    return values, w
