"""FAMILY 12 — a value the engine could name, but did not.

Each consumer here already existed: a callable instance resolves through type_call_target,
a chained result and an attribute receiver both go through call_recv_type. They were
starved because the VALUE had no type. Every case is ordinary Python.
"""


class Widget:
    def emit(self) -> str:
        return "widget"

    @classmethod
    def make(cls) -> "Widget":
        return cls()

    def __call__(self) -> str:
        return "called"


class Factory:
    def build(self) -> Widget:
        return Widget()


class UsesFactory:
    """A field written from a CALL, not a construction. field_type_from_construction
    enumerated value shapes and a factory call was not one of them."""
    def __init__(self) -> None:
        self.made = Factory().build()          # initializerKind = CALL

    def run(self) -> str:
        return self.made.emit()                # receiver typed from the call's return


def method_alias_on_class() -> str:
    make = Widget.make                         # local aliases a classmethod
    return make().emit()                       # the call AND its result must resolve


def method_alias_on_instance() -> str:
    w = Widget()
    emit = w.emit                              # local aliases a bound method
    return emit()


def getattr_literal() -> str:
    w = Widget()
    m = getattr(w, "emit")                     # literal name, known receiver type
    return m()


def getattr_with_default(rec) -> str:
    w = getattr(rec, "widget", Widget())       # result is at least the default's type
    return w.emit()


def getattr_default_callable(rec) -> str:
    c = getattr(rec, "handler", Widget())      # the default is a CALLABLE INSTANCE
    return c()
