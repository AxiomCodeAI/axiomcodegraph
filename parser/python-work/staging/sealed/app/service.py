"""Every receiver shape, with the answer known by construction."""
import core
from core import Node, make_node
from core.base import Leaf, Registry
from core.factory import Builder, TypedBuilder

_Alias = Node


class Service(Leaf):
    registry: Registry

    def __init__(self, label: str, seed: Node) -> None:
        super().__init__(label)
        self.registry = Registry()
        self.seed = seed

    def by_self(self) -> str:
        return self.name()

    def by_inherited_attribute(self) -> Node:
        return self.registry.store(self.seed)

    def by_parameter(self, other: Builder) -> Node:
        return other.build()

    def by_local_constructor(self) -> Node:
        node = Node("local")
        return node.add(node)

    def by_local_factory(self) -> Node:
        made = make_node("factory")
        return made.add(made)

    def by_classmethod(self) -> Node:
        builder = Builder.of("cm")
        return builder.build()

    def by_alias(self) -> Node:
        aliased = _Alias("alias")
        return aliased.add(aliased)

    def by_package_reexport(self) -> Node:
        return core.make_node("reexport")

    def by_subclass_field(self) -> Node:
        typed = TypedBuilder("t")
        return typed.rebuild()

    def by_fluent_chain(self) -> str:
        node = Node("chain")
        return node.add(node).name()
