"""Reduction: a `with ... as (a, b)` target is spelled load-shaped.

Mined from:
  anaconda/numba/core/boxing.py:234,294  with cgutils.loop_nest(...) as [idx]:
  anaconda/joblib/test/test_dask.py      (12 sites)
  anaconda/xarray/tests/test_backends.py (7 sites)
  87 files across the four corpora contain `with ... as (` or `as [`.

The SAME store target takes three different spellings depending on context:

    (a, b) = m              -> tuple_pattern        (store-shaped)
    for (i, j) in x:        -> tuple_pattern        (store-shaped)
    with c as (a, b):       -> as_pattern_target > tuple   (LOAD-shaped)
    [n, o] = p              -> list_pattern         (store-shaped)
    with d as [e, f]:       -> as_pattern_target > list    (LOAD-shaped)

CPython 3.10.4 marks every one of them ctx=Store, and symtable binds a, b, e,
f, i, j, n, o identically in all six.

IMPLEMENTATION RISK: an extractor that discovers unpacking bindings by looking
for tuple_pattern / list_pattern silently binds nothing for the `with` forms --
a MISSING py_binding, which is a Gate 1 failure rather than a shape difference.
Found by the count differential (ts `list` count high, `list_pattern` low) in
sweep 2, not by any fixture.
"""
import contextlib


@contextlib.contextmanager
def pair():
    yield (1, 2)


def uses_all_five_shapes(m, p, xs):
    (a, b) = m
    [n, o] = p

    for (i, j) in xs:
        print(i, j)

    with pair() as (k, v):          # k and v ARE bound
        print(k, v)

    with pair() as [e, f]:          # e and f ARE bound
        print(e, f)

    return a, b, n, o
