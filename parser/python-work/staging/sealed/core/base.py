"""Declarations every other module reaches."""


class Node:
    label: str

    def __init__(self, label: str) -> None:
        self.label = label
        self.children = []

    def add(self, child: "Node") -> "Node":
        # returns self -- the fluent shape
        self.children.append(child)
        return self

    def name(self) -> str:
        return self.label


class Leaf(Node):
    def name(self) -> str:
        # inherited-then-overridden
        return super().name()


class Registry:
    def __init__(self) -> None:
        self.node = Node("root")

    def store(self, node: Node) -> Node:
        return node


def make_node(label: str) -> Node:
    return Node(label)
