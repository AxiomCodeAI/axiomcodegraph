"""Base and derived classes — cross-class linkage targets."""
import functools
from typing import overload


def audit(label):
    """Parameterised decorator — outer returns middle returns wrapper."""
    def middle(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            return fn(*args, **kwargs)
        return wrapper
    return middle


class Base:
    KIND = "base"                      # class-level attribute
    __slots__ = ("name", "tags")

    def __init__(self, name, tags=None, *extra, mode="ro", **options):
        self.name = name
        self.tags = tags or []
        self.extra = extra
        self.mode = mode
        self.options = options

    def describe(self):
        return f"{Base.KIND}:{self.name}"

    @staticmethod
    def make_default():
        return Base("default")

    @classmethod
    def of(cls, name):
        return cls(name)

    @property
    def label(self):
        return self.describe()


class Child(Base):
    KIND = "child"

    def describe(self):                # override — MRO resolution target
        parent = super().describe()
        return f"{parent}/{Child.KIND}"

    @audit("child")
    def tagged(self, *items, **meta):
        return self.merge(*items, **meta)

    def merge(self, *items, **meta):
        return list(items) + sorted(meta)


class Sibling:
    """No inheritance relationship — describe() here must NOT link to Base."""
    def describe(self):
        return "sibling"
