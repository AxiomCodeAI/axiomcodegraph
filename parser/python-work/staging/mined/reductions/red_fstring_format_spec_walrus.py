"""Reduction: an f-string format spec beginning with `=` is read as a walrus.

Mined from CPython 3.10.4 stdlib:
  test/test_fstring.py:1219   self.assertEqual(f'{x:=10}', '        20')
  test/test_fstring.py:1272   same

CPython 3.10.4:  FormattedValue(value=Name('x', Load), format_spec='=10')
                 -- `x` is READ, nothing is bound.
tree-sitter 0.21: interpolation > named_expression(x, 10)
                 -- `x` is WRITTEN, and format_specifier never appears.

Blast radius: a py_binding that has no counterpart in CPython, and a symtable
predicate flip (is_assigned) on a name that is only read.  This is a Gate 1
failure, not merely a shape difference.
"""


def width_formatted(value):
    return f"{value:=10}"          # <-- CPython: format spec; tree-sitter: walrus


def real_walrus(seq):
    return f"{(total := sum(seq))}"  # <-- genuine walrus, both agree
