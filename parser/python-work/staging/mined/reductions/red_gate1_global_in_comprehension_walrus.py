"""Reduction: an enclosing `global` reaches into a comprehension's scope.

Mined from CPython 3.10.4 stdlib test/test_named_expressions.py:554.

    def f():
        global GLOBAL_VAR
        [GLOBAL_VAR := sentinel for _ in range(1)]

A walrus inside a comprehension binds in the ENCLOSING function scope -- which
A3 already handles.  What is missed is that the enclosing scope declared the
name `global`, so the binding is a GLOBAL store, not a nonlocal one, and the
comprehension's own symbol table records it as global and declared-global.

CPython 3.10.4 symtable (comprehension block, name GLOBAL_VAR):
    is_global=1 is_assigned=1 is_declared_global=1  -> 00100010100
A3 @ b800789:
    is_nonlocal=1 is_free=1 is_assigned=1           -> 00011010000

Gate 1 failure on three of the eleven predicates, and the two answers disagree
about where the value lands: module namespace versus enclosing function cell.
"""

GLOBAL_VAR = None
sentinel = object()


def writes_a_global_from_a_comprehension():
    global GLOBAL_VAR
    [GLOBAL_VAR := sentinel for _ in range(1)]
    return GLOBAL_VAR


def writes_a_nonlocal_from_a_comprehension():
    local_var = None

    def inner():
        nonlocal local_var
        [local_var := 1 for _ in range(1)]

    inner()
    return local_var
