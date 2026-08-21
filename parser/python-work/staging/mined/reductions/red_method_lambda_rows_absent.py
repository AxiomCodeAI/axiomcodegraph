"""Reduction: a lambda produces no `py_method` row, so its parameters vanish.

Measured over the whole CPython 3.10.4 stdlib against A3 @ bdcfa3c:
  1,588 missing py_method rows across 291 files -- EVERY one a lambda.
  0 missing `def`/`async def`, 0 spurious methods, 0 parameter mismatches.

The schema is explicit that lambdas belong in the relation (§2.7):

  - "`def`, `async def`, `lambda`, and the two synthetic initializers."
  - column 0  `name`        -> `<lambda>`
  - column 16 `methodKind`  -> includes `LAMBDA`
  - column 23 `declaringBindingLinkHash` -> "" *for lambdas*
  - and the justification for column 32 existing at all: "`startColumn` is
    required on top of that, for the same reason as py_scope: **lambdas**.
    `g = (lambda: 1, lambda: 2)` produces two py_method rows whose
    qualifiedName, signature and startLine are all identical ... lambdas are
    369 rows in the corpus and the failure is silent."

A lambda DOES get a py_scope (LAMBDA) and its parameters DO get py_binding
rows, so Gate 1 is clean here -- this is invisible to a scope/binding check
and only shows up against py_method / py_method_parameter.

Consequence: `sorted(xs, key=lambda r: r.name)` contributes no parameter row,
so argument->parameter flow has nothing to bind `r` to, and the schema's stated
reason for `startColumn` being in the py_method primary key is a hazard that
cannot currently arise because the rows do not exist.
"""
import functools


def sort_by_name(rows):
    return sorted(rows, key=lambda r: r.name)


def two_lambdas_one_line():
    # the exact shape §2.7 cites: identical qualifiedName, signature and
    # startLine, distinguished only by startColumn
    return (lambda: 1, lambda: 2)


def lambda_with_every_parameter_kind():
    return lambda a, b, /, c, *args, d=1, **kw: (a, b, c, args, d, kw)


def lambda_as_a_default(cb=lambda x: x + 1):
    return cb


reduce_with_lambda = functools.partial(functools.reduce, lambda acc, y: acc + y)
