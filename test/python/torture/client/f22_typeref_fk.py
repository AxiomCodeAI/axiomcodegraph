"""FAMILY 22 — an annotation written as a DOTTED, module-qualified name.

`type_name_in_module` resolves a SIMPLE name: one declared in the module, or imported into
it at module level. A dotted annotation is neither — `impl.Node` is not a name in this
module's namespace, it is an attribute of one — so the name lookup cannot answer and only
the parser's own resolved link on the type reference can.

That link is what #52 began consuming. Derived from real sites rather than invented: on a
measured codebase, removing the FK path loses exactly this shape (`node: nodes.Template`,
then `node.find_all(...)`), costing 41 links and gaining a wrong answer.

WHAT THIS FAMILY DOES AND DOES NOT LOCK -- stated because the distinction matters.

It locks the BEHAVIOUR: a dotted, module-qualified annotation types its receiver. Remove
that capability by any route and these three links fail.

It does NOT isolate the FK clause specifically. Reverting only #52's three FK clauses
leaves this family at 3/3, because at this scale the dotted name is also reachable through
the module-member path. On a real codebase it is not -- 15 sites there resolve ONLY via the
FK -- but the conditions that make the module-member path fail (a large package with
re-export chains and cross-module imports) are not reproducible in a fixture of this size.

So this is a behaviour guard, not a clause guard, and it is labelled as such rather than
being presented as proof that the FK path is exercised. The evidence for that path is the
corpus measurement recorded on issue #47.
"""
from aliaspkg.deep import impl


def label_via_dotted(node: impl.Node) -> str:
    return node.label()


def build_via_dotted() -> str:
    made: impl.Node = impl.build_node()
    return made.label()
