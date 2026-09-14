"""Cross-module call sites. Every callee is internal and must resolve."""
from typing import overload

from .models import Base, Child, Sibling, combine_all
from .helpers import build_pipeline, passthrough


class Service:
    def __init__(self, base, child):
        self.base = base
        self.child = child

    @overload
    def lookup(self, key: str) -> Base: ...
    @overload
    def lookup(self, key: int) -> Child: ...
    def lookup(self, key):
        return self.fetch(key)

    def fetch(self, key):
        return key

    def run(self, items):
        d = Base.make_default()           # NAME  -> Base.make_default
        e = Child.of("x")                 # NAME  -> Base.of (inherited)
        g = self.helper(d, e)             # SELF  -> Service.helper

        def inner(seq):                   # nested def in a method
            return combine_all(seq, seq)  # NONE  -> models.combine_all

        h = inner(items)                  # NONE  -> the nested def
        p = build_pipeline(items, strict=True)   # NONE -> helpers.build_pipeline
        q = passthrough(1, 2, key="z")    # NONE  -> helpers.passthrough
        s = Sibling()                     # NAME  -> Sibling ctor
        return combine_all(g, [h, p, q, s])

    def helper(self, left, right):
        return self.combine(left, right)  # SELF -> Service.combine

    def combine(self, left, right):
        return combine_all(left, right)   # NONE -> models.combine_all
