"""Package that RE-EXPORTS its classes, the shape `unittest` uses.

`framework.TestCase` is not declared here — it is imported from `framework.case`.
A resolver that only matches qualified-name suffixes cannot find it, because
`framework.TestCase` is not a suffix of `framework.case.TestCase`. This is the
exact shape that left 244 `unittest.TestCase` bases unresolved in the stdlib.
"""
from .case import TestCase
from .runner import Runner

__all__ = ['TestCase', 'Runner']
