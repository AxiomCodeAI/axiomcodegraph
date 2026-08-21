"""Reduction: `member_type`, the one in-scope node type no corpus reaches.

0 occurrences in 21,370 mined files (CPython 3.10.4 stdlib, 11,873 files of
site-packages, 11 GitHub repositories).  It is nevertheless REACHABLE from
valid 3.10 source: an annotation whose head is a generic and which is then
attribute-accessed takes the `type` grammar path rather than the expression
path, and only there does `$.type '.' identifier` apply.

CPython 3.10.4:  AnnAssign(annotation=Attribute(value=Subscript(...)))
tree-sitter 0.21: type > member_type > (generic_type, identifier)

Nobody writes this, which is why mining cannot produce it: it needs an
authored fixture.  `typing.List[int]` does NOT produce member_type -- a dotted
head takes the ordinary attribute/subscript path.
"""
import typing


class Box:
    pass


x: list[int].a = 1                 # member_type
y: list[list[int].a] = []          # member_type nested in a type_parameter
z: typing.List[int] = []           # NOT member_type -- plain attribute+subscript


def f() -> list[int].a:
    return x
