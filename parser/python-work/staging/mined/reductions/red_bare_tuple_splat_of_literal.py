"""Reduction: `*<literal>` inside an UNPARENTHESISED tuple fails to parse.

Mined from:
  site-packages/torch/distributed/elastic/rendezvous/utils.py:83
      host, *rest = endpoint, *[]
  black/tests/data/cases/expression.py:162
      g = 1, *"ten"

CPython 3.10.4:  parses; Tuple(elts=[..., Starred(...)])
tree-sitter 0.21: ERROR node, rootNode.hasError == True

The trigger is the FIRST TOKEN of the splat operand, not the splat itself:
  `a = x, *y`      ok        `a = x, *[]`    ERROR
  `a = x, *f()`    ok        `a = x, *()`    ERROR
  `a = x, *y.z`    ok        `a = x, *{1}`   ERROR
  `a = x, *y[0]`   ok        `a = x, *"s"`   ERROR
  `a = (x, *[])`   ok  -- parenthesising the tuple fixes it

Blast radius: the ERROR node swallows following statements (in the two-line
case below the ERROR spans into the next line), so one occurrence silently
removes a region of the file, not one expression.
"""

a = 1
y = [2]

ok_ident = a, *y
ok_call = a, *list(y)
ok_paren = (a, *[])

broken = a, *[]        # <-- ERROR
next_statement = 1     # <-- swallowed by the ERROR above
