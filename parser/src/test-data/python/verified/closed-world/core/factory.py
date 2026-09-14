"""CLS-constructor and classmethod mechanisms."""
from core.base import Node


class Builder:
    KIND = "builder"

    @classmethod
    def of(cls, name):
        # cls(...) is a constructor call through cls -- resolves to Builder
        return cls(name)

    @classmethod
    def make_default(cls):
        return cls.of("default")

    def __init__(self, name):
        self.name = name
        self.node = Node(name)

    def build(self):
        # depth-2 chain: self.node -> Node, .label() -> str
        return self.node.label()


class TypedBuilder(Builder):
    def build(self):
        # inherited attribute across modules, then a chain off it
        return self.node.add(Node("x")).count()
