"""Reduction: calling a function named `match` or `case` in statement position.

Mined from:
  black/tests/data/cases/pattern_matching_style.py:14-33  match(\n arg \n)
  anaconda/conda_build/build.py:469        match["submatches"] = sorted(...)
  anaconda/paramiko/config.py:527,529      match["negate"] = True
  anaconda/sympy/solvers/ode/ode.py:579    match['eq'] = eq
  anaconda/sympy/solvers/ode/systems.py:309

CPython 3.10.4:  Expr(Call(func=Name('match'))) -- `match` is a soft keyword,
                 a call is unambiguous.
tree-sitter 0.21: ERROR, rootNode.hasError == True

The trigger is a STATEMENT that begins with `match` followed by `(` or `[`:

    match(x)              ERROR      match = 1            ok
    match(\n x \n)         ERROR      m = match(x)         ok
    match["k"] = 1        ERROR      x = match["k"]       ok
    match[0]              ERROR      match.attr = 1       ok

`case[...]` and `type[...]` are fine, so it is specific to `match`.  The
subscript form is the one that shows up in the wild: a variable named `match`
holding a dict or a regex match object is ordinary Python.
"""
import re


def match(pattern, text):
    return re.match(pattern, text)


def case(x):
    return x


match(r"\d+", "42")     # <-- ERROR: call in statement position
case(1)                 # <-- ERROR

m = match(r"\d+", "42")  # ok -- not statement-initial
m.group(0)               # ok

groups = {}
groups["k"] = 1          # ok -- the name is not `match`

match = {}
match["submatches"] = 1  # <-- ERROR: subscript store on a name called `match`
match["negate"]          # <-- ERROR: subscript load in statement position
value = match["k"]       # ok -- not statement-initial
match.attr = 1           # ok -- attribute, not subscript
