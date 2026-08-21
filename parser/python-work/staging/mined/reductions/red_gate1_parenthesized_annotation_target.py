"""Reduction: `(x): int` is an annotation, NOT a declaration.

Mined from CPython 3.10.4 stdlib test/test_grammar.py:386.

    def f2bad():
        (no_such_global): int
        print(no_such_global)

PEP 526: an annotation only DECLARES when its target is a simple name.  Wrap
the target in parentheses and CPython evaluates the annotation but binds
nothing, so the name stays global -- which is the whole point of the stdlib
test: calling f2bad() raises NameError, not UnboundLocalError.

CPython 3.10.4 symtable (function f2bad, name no_such_global):
    is_global=1 is_referenced=1                     -> 00100001000
A3 @ b800789:
    is_local=1 is_assigned=1 is_referenced=1        -> 01000011000

A Gate 1 failure: a py_binding that CPython says does not exist, in the scope
where it matters most (a local shadowing a global changes every read of that
name below it).

`x: int` without parentheses DOES declare, and both sides agree on that -- the
divergence is exactly the parenthesised form.
"""


def parenthesised_target_does_not_bind():
    (no_such_global): int
    print(no_such_global)


def plain_target_does_bind():
    x: int
    print(x)
