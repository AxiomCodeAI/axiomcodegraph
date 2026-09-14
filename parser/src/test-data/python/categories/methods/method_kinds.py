"""Every method kind the schema distinguishes."""
import abc
import functools


class Kinds(abc.ABC):
    def instance_method(self) -> int:
        return 1

    @staticmethod
    def static_method() -> int:
        return 2

    @classmethod
    def class_method(cls) -> int:
        return 3

    @property
    def prop(self) -> int:
        return 4

    @prop.setter
    def prop(self, value: int) -> None:
        self._v = value

    @functools.cached_property
    def cached(self) -> int:
        return 6

    @abc.abstractmethod
    def must_override(self) -> int: ...

    def __init_subclass__(cls, **kwargs: object) -> None:
        # No super() call: it resolves into object, outside any analysis root.
        # methodKind=CLASS_METHOD by language rule is what this tests.
        cls.registered = True

    def generator(self):
        yield 1

    async def coroutine(self) -> int:
        return 8

    async def async_generator(self):
        yield 9


def positional_only(a, b, /, c):
    return a + b + c


def keyword_only(*, a, b):
    return a + b


def star_args(*args, **kwargs):
    return len(args) + len(kwargs)


def defaults(a=1, b=(), c=None):
    return a


def exercise() -> int:
    return positional_only(1, 2, 3) + keyword_only(a=1, b=2) + star_args(1, x=2) + defaults()
