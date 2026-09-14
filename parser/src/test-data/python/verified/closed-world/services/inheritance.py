"""SELF and SUPER, entirely in-root so the ceiling stays 100%."""
from core.base import Leaf, Node


class Tagged(Node):
    def label(self):
        return super().label()      # SUPER -> Node.label

    def describe(self):
        return self.label()         # SELF -> Tagged.label (overrides Node)

    def total(self):
        return self.count()         # SELF -> inherited Node.count


class DeepLeaf(Leaf):
    def label(self):
        return super().label()      # SUPER -> Leaf.label -> Node.label
