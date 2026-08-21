"""Reduction: under PEP 563 an annotation creates no scopes.

Mined from pydantic/tests/benchmarks/test_fastapi_startup_simple.py:36 --
the ONLY file in 21,370 where the tree-sitter scope-construct count and
symtable's block count disagree.

    from __future__ import annotations
    state: Annotated[str, AfterValidator(lambda x: x.upper())]

CPython 3.10.4:  the annotation is never visited, so the lambda has NO block.
tree-sitter 0.21: a `lambda` node exists, and a naive scope builder makes a
                  scope for it.

A3 records this rule as already handled.  It is filed here as a CORPUS fact:
real code triggers it in 1 file out of 21,370, and no staged fixture covers a
scope-bearing construct inside a PEP 563 annotation -- so nothing would catch a
regression.
"""
from __future__ import annotations

from typing import Any, Callable


def validate(fn: Callable[[str], str]) -> Any:
    return fn


class Model:
    # lambda inside an annotation: no scope under PEP 563
    state: list[validate(lambda s: s.upper())] = []
    # comprehension inside an annotation: likewise no scope
    tags: list[[t for t in ("a", "b")]] = []


def annotated(a: lambda: 1, b: [x for x in range(3)]) -> lambda: 2:
    return a
