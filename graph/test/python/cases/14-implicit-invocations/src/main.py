"""Implicit invocations: methods the interpreter runs with no call written (#704).

  metaclass, inherited   `class Model(Base)` where Base carries `metaclass=Meta` runs
                         Meta.__new__ and Meta.__init__ for Model too; only the keyword
                         on Base was read before, so every subclass statement was silent.
  __init_subclass__      `class Plugin(Registry)` runs Registry.__init_subclass__ with no
                         metaclass involved at all.
  metaclass property     `Model.fields` and `cls.fields` read a property defined on the
                         METACLASS: the class is an instance of it, so the getter runs.
  deprecated property    `@property` stacked with `@deprecated(...)`: the wrapper warns and
                         calls through, so a read is still a call on the getter. Read from
                         a function main() never runs: the wrapper's frame is library
                         code, so a traced read would attribute the getter to the library
                         and score the engine's (correct) edge as a fabrication; unexercised,
                         the edge is pinned by the golden and left unverified by the trace.
  class-body lambda      a handler table `{tuple: lambda self, obj: self.handle_tuple(obj)}`
                         is called as `self._handlers[k](self, obj)`; the lambda's `self`
                         is the instance, as a method's is.
"""
from typing_extensions import deprecated   # warnings.deprecated on 3.13; a wrapper that warns and calls through


class Meta(type):
    def __new__(mcls, name, bases, ns):
        ns["_built_by_meta"] = name
        return super().__new__(mcls, name, bases, ns)

    def __init__(cls, name, bases, ns):
        super().__init__(name, bases, ns)
        cls._inited = True

    @property
    def fields(cls):
        # a property on the METACLASS: `Model.fields` runs this, `Model().fields` does not
        return [k for k in vars(cls) if not k.startswith("_")]


class Base(metaclass=Meta):
    pass


class Model(Base):
    # the inherited metaclass: no keyword here, Meta.__new__ / __init__ still run
    x = 1

    @classmethod
    def names(cls):
        return cls.fields            # the metaclass property through `cls`

    @property
    @deprecated("use x")
    def old_x(self):
        return self.x


class Registry:
    plugins = []

    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)
        Registry.plugins.append(cls)


class Plugin(Registry):
    pass


class Schema:
    _handlers = {
        tuple: lambda self, obj: self.handle_tuple(obj),
        list: lambda self, obj: self.handle_list(self.first(obj)),
    }

    def handle_tuple(self, obj):
        return ("tuple", len(obj))

    def handle_list(self, first):
        return ("list", first)

    def first(self, obj):
        return obj[0]

    def generate(self, obj):
        handler = self._handlers.get(type(obj))
        return handler(self, obj)


def deprecated_read():
    return Model().old_x             # a deprecated property is still a call (not traced: see above)


def main():
    print(Model.fields)              # metaclass property on the class object
    print(Model.names())
    print(Registry.plugins)
    s = Schema()
    print(s.generate((1, 2)))
    print(s.generate([3, 4]))


if __name__ == "__main__":
    main()
