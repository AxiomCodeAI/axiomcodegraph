"""LOCAL-VARIABLE typing -- the largest measured lever.

Every receiver here is a bound local whose type is stated nowhere, and is
recoverable only by joining the binding to its assignment value.
"""
from core.base import Node, Registry, make_node, make_registry
from core.factory import Builder, TypedBuilder


def local_from_constructor():
    node = Node("a")          # local <- constructor
    return node.label()


def local_from_module_function():
    node = make_node("b")     # local <- return of an in-root function
    return node.label()


def local_from_classmethod():
    builder = Builder.of("c")  # local <- classmethod returning cls(...)
    return builder.build()


def local_reassigned_same_type():
    node = Node("d")
    node = Node("e")
    return node.label()


def local_chain():
    reg = make_registry()      # local <- Registry
    reg.store(Node("f"))
    return reg.first().label() # CALL_RESULT receiver, in-root


def local_passed_as_argument():
    node = Node("g")
    return consume(node)       # arg -> param flow


def consume(node):
    """Unannotated parameter; type comes only from callers."""
    return node.label()


def attribute_chain_depth_three():
    builder = TypedBuilder("h")
    return builder.node.add(Node("i")).count()
