"""Reduction: annotations take two incompatible shapes depending on the head.

Not a parse failure -- a MODELING DIVERGENCE, escalated rather than decided.

The grammar switches representation on whether the subscripted head is a bare
identifier or a dotted name:

  x: list[int]           ->  type > generic_type > identifier + type_parameter
  x: typing.List[int]    ->  type > subscript > attribute        (ordinary expr)
  a: int | None          ->  type > binary_operator              (ordinary expr)
  a: list[int] | None    ->  type > union_type                   (type-only)

CPython 3.10.4 gives ONE shape for all four: Subscript / BinOp over ordinary
expressions.  Measured at scale this is the single largest divergence in the
corpus: 1,582 of 11,871 site-packages files disagree on subscript count, and
55,080 `type_parameter` nodes exist across the corpus where CPython has none.

The question for the human is what py_expression and py_type should carry: the
grammar's type-flavoured spelling, or CPython's uniform expression spelling.
Both are defensible; picking the grammar's means py_type_base for
`class C(Generic[T])` and a type reference in an annotation are shaped
differently for the same source text.
"""
import typing
from typing import Dict, List


x: list[int] = []
y: typing.List[int] = []
z: List[Dict[str, int]] = []


def f(a: int | None, b: list[int] | None) -> str | None:
    return None


class G(typing.Generic[typing.TypeVar("T")]):
    pass


# A slice inside a subscripted annotation is `constrained_type` -- a node the
# ceiling deducts as PEP 695, yet valid 3.10 source reaches it.  CPython:
# Subscript(slice=Slice(lower=Name('str'), upper=Name('int'))).
sliced: dict[str:int] = {}
sliced_nested: list[dict[str:int]] = []
not_an_annotation = {}[str:int] if False else None
