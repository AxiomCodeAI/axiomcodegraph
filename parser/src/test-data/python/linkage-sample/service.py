"""Cross-module, cross-class call sites."""
from typing import overload

from .models import Base, Child, Sibling
from .helpers import build_pipeline, passthrough


class Service:
    def __init__(self, base: Base, child: Child):
        self.base = base
        self.child = child
        self.registry = {}

    @overload
    def lookup(self, key: str) -> Base: ...
    @overload
    def lookup(self, key: int) -> Child: ...
    def lookup(self, key):
        """Real implementation after two @overload stubs."""
        return self.registry[key]

    def run(self, items):
        a = self.base.describe()          # -> Base.describe
        b = self.child.describe()         # -> Child.describe (override)
        c = Sibling().describe()          # -> Sibling.describe, NOT Base
        d = Base.make_default()           # staticmethod
        e = Child.of("x")                 # classmethod, cls-bound
        f = self.child.label              # property
        g = self.helper(a, b)             # same-class method

        def inner(seq):                   # nested def inside a method
            return [x for x in seq if x]

        spread = self.child.merge(*items, **{"k": 1})
        pipeline = build_pipeline(items, strict=True)
        pt = passthrough(1, 2, key="z")
        return [a, b, c, d, e, f, g, inner(items), spread, pipeline, pt]

    def helper(self, left, right):
        return self.combine(left, right)

    def combine(self, left, right):
        return [left, right]
