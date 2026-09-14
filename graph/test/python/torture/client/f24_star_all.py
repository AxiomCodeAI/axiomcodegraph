"""FAMILY 24 — `from x import *` obeys __all__ and the underscore rule (issue #105).

tlib/__init__.py does `from .exports import *`, and exports.py declares
`__all__ = ["Exported"]`. So at runtime `tlib.Exported` exists while `tlib.NotExported`
and `tlib._Private` do not -- the first is absent from __all__, the second is excluded by
the underscore rule.

HOW THIS FAMILY ASSERTS ITSELF, because a guard that REMOVES answers has no new link to
find. The proof is an edge that must not exist. Both forbidden names are referenced from
code that RUNS and raises AttributeError, which is what makes the assertion scoreable:
the call never executes, so no ground-truth link exists, and an engine that resolves it
anyway is reporting a sole answer to code that cannot run -- a WRONG.

The first draft put those references in a function main.py never called. The suite
rejects that outright ("fixture function never executed"), and rightly: an unexecuted
fixture contributes no ground truth and is silently unscored. Raising at runtime keeps
the negative assertion inside the scoring model instead of beside it.
"""
import tlib


def via_star_export() -> str:
    # Exported IS in __all__, so this resolves and runs.
    return tlib.Exported().run()


def absent_from_all() -> str:
    # NotExported is defined in exports.py but absent from its __all__, so `import *`
    # never binds it. The engine must not resolve this call.
    try:
        return tlib.NotExported().run()
    except AttributeError:
        return "absent"


def absent_by_underscore() -> str:
    # _Private is excluded by the underscore rule, which applies whether or not __all__
    # exists. The engine must not resolve this call either.
    try:
        return tlib._Private().run()
    except AttributeError:
        return "private-absent"
