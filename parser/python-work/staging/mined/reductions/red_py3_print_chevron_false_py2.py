"""Reduction: valid Python 3 that tree-sitter labels `print_statement`+`chevron`.

Mined from CPython 3.10.4 stdlib:
  test/test_print.py:194   print >> sys.stderr, "message"

That line is inside `test_stream_redirection_hint_for_py2_migration`, which
asserts that Python 3 raises TypeError for it -- so it is VALID PYTHON 3
SOURCE, parsed by CPython 3.10.4 as:

    Expr(Tuple([BinOp(Name('print') >> Attribute(sys.stderr)), 'message']))

tree-sitter 0.21 instead produces print_statement > chevron, with
rootNode.hasError == False.

IMPLEMENTATION BUG, high severity: A3's Tier-1 Python-2 rejection keys on
exactly {print_statement, exec_statement, chevron} and emits NO FACTS for a
rejected file.  A single line of this shape therefore deletes a whole valid
module from the output.  Secondary damage even if the file is kept: the
BinOp, the tuple, and the load of the `print` builtin are all absent from the
tree.
"""
import sys


def hint_for_py2_migration():
    try:
        print >> sys.stderr, "message"
    except TypeError:
        return True
    return False


def rshift_on_a_name(left, right):
    return left >> right, "extra"
