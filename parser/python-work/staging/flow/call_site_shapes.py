"""Java analogue: expressions/ (invocation forms).

One fixture per receiverKind the schema defines, so every branch of call-site
classification has at least one witness. The receiver's SHAPE is all the parser
honestly knows about a duck-typed receiver; the engine does the typing.
"""

from pkg.models import Account, Ledger


class Widget:
    registry = {}

    def __init__(self, name):
        self.name = name
        self.children = []

    def render(self):
        return self.name

    @classmethod
    def build(cls, name):
        # CLS receiver
        return cls(name)

    @classmethod
    def cls_receiver(cls):
        return cls.registry.get("x")

    @staticmethod
    def helper():
        return 1

    def self_receiver(self):
        # SELF
        return self.render()

    def attribute_receiver(self):
        # ATTRIBUTE: receiver is itself an attribute access
        return self.children.append(1)

    def subscript_receiver(self):
        # SUBSCRIPT: receiver is an indexed element
        return self.children[0].render()

    def call_result_receiver(self, name):
        # CALL_RESULT
        return Widget.build(name).render()

    def super_receiver(self):
        # SUPER -- MRO slice, not virtual dispatch
        return super().__repr__()


def bare_name_call(value):
    # SIMPLE_CALL: no receiver at all
    return len(value)


def name_receiver(widget):
    # NAME: the 50.7% case
    return widget.render()


def module_receiver(payload):
    import json
    # MODULE receiver
    return json.dumps(payload)


def type_receiver(name):
    # receiver is a TYPE, so this is a static-ish call
    return Widget.helper()


def literal_receiver(parts):
    # LITERAL receiver -- "".join is a real and common shape
    return ", ".join(parts)


def constructor_like_call(owner):
    # Capitalized bare name: syntactically identical to a function call. The
    # parser must NOT guess; only resolution can say it constructs an Account.
    return Account(owner)


def instance_call_via_dunder(callable_obj):
    # calling an INSTANCE dispatches to __call__
    return callable_obj()


def dynamic_call(obj, method_name):
    # unresolvable by construction -- must be marked, not guessed
    return getattr(obj, method_name)()


def nested_calls_same_start_offset(ledger, account):
    # sink(taint(x)) vs taint(sink(x)): identical bindings, opposite data flow.
    # Only edge roles distinguish them.
    ledger.record(normalise(account))
    normalise(ledger.record(account))


def normalise(value):
    return value


def keyword_and_star_shapes(account, ledger, extras):
    positional_and_keyword(account, ledger, note="n")
    positional_and_keyword(*(account, ledger))
    positional_and_keyword(account, ledger, **extras)


def positional_and_keyword(account, ledger, note=None):
    return note
