"""Reduction: a column-0 comment between a decorator and its `def`.

Mined from:
  pydantic/tests/mypy/outputs/mypy-plugin_ini/frozen_field.py:22

CPython 3.10.4:  parses; comment-only lines are ignored by the tokenizer
                 regardless of their column.
tree-sitter 0.21: ERROR wrapping the decorator, rootNode.hasError == True.

Blast radius is worse than the error flag suggests: the decorator is orphaned
into the ERROR node and the `def` becomes an UNDECORATED function_definition,
so a consumer that tolerates errors silently loses the decorator.  The same
comment inside a function body parses fine, so the trigger is specifically the
decorator/def gap.
"""


class C:
    @property
# a column-0 comment inside an indented class body
    def m(self):
        return 1
