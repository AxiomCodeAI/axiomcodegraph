"""Base classes. No external calls — every callee is defined in this package."""
from typing import overload            # decorator NAME only, never called


def combine_all(left, right):
    """Module-level helper, used instead of builtins."""
    return [left, right]


def audit(label):
    """Parameterised decorator: audit(...) -> middle -> wrapper."""
    def middle(fn):
        def wrapper(*args, **kwargs):
            return fn(*args, **kwargs)
        return wrapper
    return middle


class Base:
    KIND = "base"

    def __init__(self, name, tags=None, *extra, mode="ro", **options):
        self.name = name
        self.tags = tags
        self.extra = extra
        self.mode = mode
        self.options = options

    def describe(self):
        return self.render(Base.KIND)

    def render(self, prefix):
        return combine_all(prefix, self.name)

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

    def describe(self):
        parent = super().describe()
        return self.render(parent)

    @audit("child")
    def tagged(self, *items, **meta):
        return self.merge(*items, **meta)

    def merge(self, *items, **meta):
        return combine_all(items, meta)


class Sibling:
    """Same-named method, no inheritance link to Base."""
    def describe(self):
        return combine_all("sibling", "x")
