"""Classmethod factories and cls-construction."""
from core.base import Node, Registry


class Builder:
    def __init__(self, name: str) -> None:
        self.name = name
        self.registry = Registry()

    @classmethod
    def of(cls, name: str) -> "Builder":
        # cls(...) constructs the enclosing class
        return cls(name)

    def build(self) -> Node:
        return self.registry.node


class TypedBuilder(Builder):
    def rebuild(self) -> Node:
        # attribute of an INHERITED field, across modules
        return self.registry.store(self.registry.node)
