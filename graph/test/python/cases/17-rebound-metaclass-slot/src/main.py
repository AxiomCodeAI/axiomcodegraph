"""A metaclass slot rebound in the same module, on both sides of the write (#929).

A library that wants its hierarchy closed writes, after every class in the file
has been declared:

    NodeType.__new__ = staticmethod(_late_new)

so that anyone building a node type LATER gets an error. The classes declared
ABOVE that line were created before it ran, by the `__new__` written in the class
body. The engine suppressed the creation edge for all of them: a foreign write to
`T.name` marks the name rebound, the write carried no position, and a use written
a thousand lines earlier in the same module lost its edge with everything else.

TWO METACLASSES, ONE ON EACH SIDE OF ITS OWN WRITE, AND THAT IS THE POINT.
The golden is deduplicated by (status, kind, caller -> callee), so one metaclass
used both before and after a write cannot show the difference: `<module> ->
Meta.__new__` would appear once whether the rule emits it for the classes above
the write only or for every class in the file. Two metaclasses make the control
visible as an ABSENT line.

  EarlyMeta   rebound AFTER its classes  -> `<module> -> EarlyMeta.__new__` PRESENT
  LateMeta    rebound BEFORE its class   -> `<module> -> LateMeta.__new__` ABSENT

`__init__` is rebound on neither, so both keep it, which is what says the classes
are being created at all and the missing line is the slot and not the class.
"""


def _late_new(mcls, name, bases, ns):
    # The real shape raises; this one builds the class so the fixture stays
    # importable, and the ordering question is identical either way.
    ns["_late"] = True
    return type.__new__(mcls, name, bases, ns)


class EarlyMeta(type):
    def __new__(mcls, name, bases, ns):
        ns["_built"] = name
        return super().__new__(mcls, name, bases, ns)

    def __init__(cls, name, bases, ns):
        super().__init__(name, bases, ns)
        cls._inited = True


class LateMeta(type):
    def __new__(mcls, name, bases, ns):
        ns["_built"] = name
        return super().__new__(mcls, name, bases, ns)

    def __init__(cls, name, bases, ns):
        super().__init__(name, bases, ns)
        cls._inited = True


# LateMeta's slot is replaced BEFORE the only class that uses it is declared.
LateMeta.__new__ = staticmethod(_late_new)


class After(metaclass=LateMeta):
    """Declared after the rebinding: the class-body __new__ is not what ran."""

    def run(self):
        return self._late


class Before(metaclass=EarlyMeta):
    """Declared before the rebinding: created by the class-body __new__."""

    def run(self):
        return self._built


class AlsoBefore(Before):
    """Inherits the metaclass rather than naming it, and still precedes the write."""

    def run(self):
        return self._built


# EarlyMeta's slot is replaced AFTER every class that uses it.
EarlyMeta.__new__ = staticmethod(_late_new)


def main():
    return Before().run() + AlsoBefore().run(), After().run()
