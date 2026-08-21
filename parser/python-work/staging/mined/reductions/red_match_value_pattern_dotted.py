"""Reduction: a dotted value pattern is a `dotted_name`, not an `attribute`.

Mined from CPython 3.10.4 stdlib test/test_patma.py (25 sites; ts counts 974
`attribute` nodes to CPython's 999).

CPython 3.10.4:  MatchValue(value=Attribute(value=Name('C'), attr='A'))
tree-sitter 0.21: case_pattern > dotted_name > identifier identifier

MODELING DIVERGENCE, escalated: no information is lost, but py_expression under
a case pattern is shaped unlike the identical source text anywhere else, and a
consumer that only treats `attribute` as a load of its base will miss that
`C` is READ here -- symtable does record `C` as referenced.
"""
import enum


class Color(enum.Enum):
    RED = 1


def classify(x):
    match x:
        case Color.RED:
            return "red"
        case [Color.RED, second]:
            return second
        case {"k": Color.RED}:
            return "dict"
        case object(attr=Color.RED):
            return "class"
        case _:
            return None
