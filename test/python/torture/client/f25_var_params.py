"""FAMILY 25 — a `**kwargs` parameter is a dict, a `*args` parameter is a tuple (#111).

Python guarantees both at every call site, whatever the signature says, so this is a
language fact rather than an inference.

TWO HALVES, and the second is the one that matters most. The first is a gap: an
unannotated var-parameter has no type at all, so a method call through it resolves to
nothing. The second is a WRONG ANSWER: an annotation on a var-parameter describes the
ELEMENT type, so reading it as the parameter's own type resolves `options.get(...)` to a
`str` method that does not exist.

The assertion is the golden edge list. A builtin call is a named boundary, not a
client->client link, so it never appears in the tier-4 ground truth -- with the rule the
sites resolve to `builtin:dict.get` and `builtin:tuple.count`, and without it they are
ambiguous_unknown. `annotated_kwargs` is what separates "the kind wins" from "the
annotation wins": typed by its annotation it would be a str, and str has no `.get`.
"""


class Holder:
    def __init__(self, **args):
        # `args` is a dict by the language, with nothing annotated anywhere.
        self.args = args

    def lookup(self, key: str) -> str:
        # Reaches the dict through a FIELD written from the var-parameter, which is the
        # shape that dominates real code -- `self.args.get(...)`.
        return str(self.args.get(key))


def collect(*values) -> int:
    # Unannotated *args: a tuple, so `.count` is tuple.count.
    return values.count(1)


def annotated_kwargs(**options: str) -> str:
    # THE MIS-TYPING CASE. `str` annotates the VALUES; options is a dict of them. Typed by
    # the annotation this resolves to a str method that does not exist.
    return str(options.get("a"))


def annotated_varargs(*values: int) -> int:
    # The same, the other kind: values is a tuple, not an int. int has no `.count`.
    return values.count(1)
