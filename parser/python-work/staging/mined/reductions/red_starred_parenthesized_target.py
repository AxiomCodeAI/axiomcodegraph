"""Reduction: a starred assignment TARGET whose operand is bracketed.

Mined from:
  anaconda/panel/tests/test_reactive.py:130   name, disabled, *(ws) = wb1

CPython 3.10.4:  Assign(targets=[Tuple([Name, Name, Starred(Name('ws'))])])
tree-sitter 0.21: ERROR, rootNode.hasError == True

The left-hand twin of finding a4-003: there a starred VALUE whose operand
starts with a bracket fails, here a starred TARGET does.

    a, *b = c        ok          a, *(b) = c      ERROR
    a, *b.c = d      ok          a, *[b] = c      ERROR
    a, *b[0] = c     ok          (a, *(b)) = c    ERROR

Redundant parentheses round an unpacking target are unusual but legal, and
CPython normalises them away.
"""

wb1 = (1, 2, 3, 4)

name, disabled, *(ws) = wb1
