"""Declaration site. Everything else in the benchmark resolves back to here."""


class Node:
    def __init__(self, name):
        self.name = name
        self.children = []

    def label(self):
        return self.name

    def add(self, child):
        self.children.append(child)
        return self

    def count(self):
        return len(self.children)


class Leaf(Node):
    def label(self):
        # SUPER receiver: MRO slice starting after Leaf. Callee declared in Node.
        return super().label()


class Registry:
    def __init__(self):
        self.nodes = []

    def store(self, node):
        self.nodes.append(node)
        return self

    def first(self):
        return self.nodes[0]


def make_node(name):
    """Return type is stated nowhere — return-flow must infer Node."""
    return Node(name)


def make_registry():
    return Registry()
