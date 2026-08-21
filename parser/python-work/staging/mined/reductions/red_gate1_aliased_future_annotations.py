"""Reduction: `from __future__ import annotations as X` still enables PEP 563.

Mined from pydantic, which uses the aliased spelling throughout:
  pydantic/docs/plugins/algolia.py:4     from __future__ import annotations as _annotations
  ...and 30+ further pydantic modules in the sweep.

A future statement is recognised by the FEATURE NAME, not by the name it is
bound to, so aliasing it changes nothing: PEP 563 is on, annotations are never
evaluated, and CPython's symtable therefore never visits them.

CPython 3.10.4 symtable: no symbol for `str` at all; `OrderedDict` imported but
                         is_referenced=0 (used only in an annotation)
A3 @ b800789:            a spurious binding for `str`;
                         `OrderedDict` is_referenced=1  (01100101000 vs 01100100000)

A3 handles the unaliased form correctly -- `from __future__ import annotations`
alone produces no disagreement -- so the gap is exactly the alias.  It is the
single largest Gate 1 signal in the repo corpus: 1,853 spurious bindings, nearly
all of them type names (`str`, `bool`, `Any`, `dict`, `list`, `int`, `Callable`)
that exist only inside annotations.
"""
from __future__ import annotations as _annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections import OrderedDict


def annotated_only(x: str) -> OrderedDict:
    return x
