"""Reduction: the trailing name of a `member_type` becomes a module binding.

Found by re-running Gate 1 against A3 @ bdcfa3c over A4's own reductions.

    x: list[int].a = 1

CPython 3.10.4: `a` is an ATTRIBUTE of the annotation expression `list[int]`.
                symtable has no symbol named `a` at all.
A3 @ bdcfa3c:   a spurious py_binding `a` in the module scope.

`member_type` is the grammar's type-context spelling of `<type>.<name>`
(grammar.js: `member_type: $ => seq($.type, '.', $.identifier)`), and the
trailing identifier is being walked as if it were a name reference rather than
an attribute label.

Low prevalence -- 0 occurrences in 70,223 mined files, because nobody writes
this -- but it is one of the node types in the freeze-1 ceiling (a4-011), so it
will be in the corpus the moment that fixture lands. The dotted spelling
`typing.List[int]` takes the ordinary attribute path and is handled correctly.
"""
import typing


x: list[int].a = 1
y: list[list[int].a] = []
z: typing.List[int] = []


def f() -> list[int].a:
    return x
