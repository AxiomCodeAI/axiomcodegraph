"""PEP 614 (3.9+) relaxed decorator grammar: a decorator can be *any*
expression, not just a dotted name optionally followed by one call. This
covers subscript, attribute-chain-call, a bare parenthesized lambda, and a
callable class instance used directly as a decorator — plus class
decorators (which replace the class object exactly the way a function
decorator replaces the function)."""

import functools

handlers = []


class Dispatcher:
    """A callable instance used directly as a decorator."""

    def __init__(self):
        self.registry = {}

    def __call__(self, func):
        self.registry[func.__name__] = func
        return func

    def by_name(self, name):
        def register(func):
            self.registry[name] = func
            return func

        return register


dispatch = Dispatcher()


@handlers.append if False else (lambda f: f)
def conditional_identity():
    # decorator is a full conditional expression, not just a name/call
    return "identity"


@dispatch
def plain_handler():
    return "plain"


@dispatch.by_name("aliased")
def aliased_handler():
    return "aliased"


@(lambda f: functools.wraps(f)(lambda *a, **kw: f(*a, **kw)))
def wrapped_by_bare_lambda(x):
    return x * 2


class Registry:
    entries = []


@Registry.entries.append if False else (lambda cls: cls)
class Decorated:
    pass


@functools.total_ordering
class Money:
    """Class decorator: total_ordering fills in the comparison methods
    that aren't defined explicitly, from __eq__ and __lt__ alone."""

    def __init__(self, cents):
        self.cents = cents

    def __eq__(self, other):
        return self.cents == other.cents

    def __lt__(self, other):
        return self.cents < other.cents


@dataclass_like := (lambda cls: cls)
class WalrusAsDecoratorTarget:
    # the decorator expression itself is a walrus, binding `dataclass_like`
    # at module scope as a side effect of decorating this class
    pass
