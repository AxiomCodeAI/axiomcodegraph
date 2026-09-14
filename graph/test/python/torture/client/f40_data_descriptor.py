"""FAMILY 40 — a USER-WRITTEN data descriptor (issue #326).

`@property` IS a data descriptor; the decorator is sugar over `__get__`/`__set__`. So the
protocol has two spellings, and the engine read one of them: a property getter's `-> X`
typed the read, and an identical `__get__` on a class-level descriptor typed nothing. Which
spelling the author chose decided whether their attribute reads resolved.

f04 is named for descriptors and contains none — its members are `@property`,
`@classmethod` and `@staticmethod`, which are the builtin descriptor-LIKE decorators
rather than the protocol itself. Before this family the only `__get__` anywhere in the
Python test tree was in f36, so a user-defined descriptor was covered by no case, project
fixture or torture family.

ONLY A DATA DESCRIPTOR IS ANSWERED, and `non_data` is here to hold that line rather than
to pass. `__get__` alone is a NON-data descriptor: an instance attribute of the same name
shadows it, so the descriptor may never run and the read may be whatever `__init__` put in
the instance dict. `__set__` (or `__delete__`) alongside it makes the descriptor win on
every read, which is the only case where answering is sound. `non_data_is_shadowed`
demonstrates that concretely, and it is a POSITIVE assertion rather than a declared miss:
the value read is the one `__init__` stored, the engine resolves it to `Other.run`, and
dropping the data-descriptor gate would flip it to `Target.run` and be confidently wrong.

THE GATE KEYS ON DECLARATION, NOT ON A REACHABLE BODY. `Deletable.__delete__` is `pass`,
which the IR records as `bodyIsStub=true`, and `mro_lookup` excludes stubs — so testing
the slot with `mro_lookup` classified that class as NON-data and left its reads
unresolved. Whether the slot has a body has nothing to do with whether Python consults it
on read. `via_delete_descriptor` is here to hold that distinction.

`via_property` is the control: the sibling spelling, which already worked, so a regression
in the shared clause is distinguishable from one in the descriptor half.
"""


class Target:
    def run(self) -> str:
        return "target"


class Other:
    def run(self) -> str:
        return "other"


class Reactive:
    """A DATA descriptor — __get__ and __set__."""

    def __get__(self, obj, objtype=None) -> Target:
        return Target()

    def __set__(self, obj, value: Target) -> None:
        self._v = value


class Deletable:
    """__get__ and __delete__ is also a data descriptor."""

    def __get__(self, obj, objtype=None) -> Other:
        return Other()

    def __delete__(self, obj) -> None:
        pass


class NonData:
    """__get__ ALONE — the instance dictionary shadows it."""

    def __get__(self, obj, objtype=None) -> Target:
        return Target()


class Holder:
    field = Reactive()
    deletable = Deletable()
    loose = NonData()

    def __init__(self) -> None:
        # the shadowing value: a NonData descriptor does not intercept this read
        self.loose = Other()


class Prop:
    @property
    def slot(self) -> Target:
        return Target()


def via_data_descriptor() -> str:
    return Holder().field.run()


def via_delete_descriptor() -> str:
    return Holder().deletable.run()


def non_data_is_shadowed() -> str:
    # `loose` is shadowed by the instance attribute __init__ stores, so the descriptor
    # never runs and the read is an Other — NOT the Target its __get__ declares. The
    # engine gets this right for the right reason: NonData declares no __set__ and no
    # __delete__, so type_is_data_descriptor excludes it and the ordinary field rules
    # answer from the instance write instead. Drop the data-descriptor gate and this
    # case flips to Target.run and is confidently wrong.
    return Holder().loose.run()


def via_property() -> str:
    # CONTROL: the sibling spelling of the same protocol.
    return Prop().slot.run()


def drive() -> str:
    return " ".join([
        via_data_descriptor(),
        via_delete_descriptor(),
        non_data_is_shadowed(),
        via_property(),
    ])
