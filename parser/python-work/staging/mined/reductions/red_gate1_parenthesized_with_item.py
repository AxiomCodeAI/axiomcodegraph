"""Reduction: a SINGLE parenthesised with-item loses its binding.

Mined from CPython 3.10.4 stdlib test/test_grammar.py:1785.

Tree shape is the cause, and it differs by arity:

    with m() as y:            with_clause > with_item > as_pattern
    with (m() as p, m() as q):with_clause > with_item > as_pattern   (x2)
    with (m() as x):          with_clause > with_item >
                                  PARENTHESIZED_EXPRESSION > as_pattern

Only the one-item parenthesised form interposes a parenthesized_expression, so
a walker that looks for as_pattern as a direct child of with_item skips it.

CPython 3.10.4 symtable (function b, name x):
    is_local=1 is_assigned=1        -> 01000010000
A3 @ b800789:
    is_global=1 is_referenced=1     -> 00100001000

Gate 1 failure: the name is not bound at all, it is recorded as a global read.
Parenthesised with-items are new in 3.10 (PEP 617's parser), so this is exactly
the kind of construct the 3.10.4 target has to get right.
"""
import contextlib


@contextlib.contextmanager
def m():
    yield 1


def single_parenthesised_item():
    with (m() as x):
        return x


def multiple_parenthesised_items():
    with (m() as p, m() as q):
        return p, q


def unparenthesised():
    with m() as y:
        return y
