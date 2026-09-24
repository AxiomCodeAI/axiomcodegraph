# Functions assigned onto an instance's members from outside its class, and lambdas
# whose parameters are typed only by the callable annotation of the name they are
# assigned to (issue #1283).
import typing
from typing import Callable, Protocol, TypeVar


class Internals:
    def parse(self, x: int) -> int:
        return x

    def run(self, x: int) -> int:
        return x


class Schema:
    def __init__(self) -> None:
        self._i: Internals = Internals()


# The class's `def parse` / `def run` are shadowed by instance attributes written here.
def init(inst: Schema, checked: bool) -> None:
    inst._i.parse = lambda x: x + 1
    if not checked:
        inst._i.run = inst._i.parse
    else:
        def _run(x: int) -> int:
            return inst._i.parse(x) * 2
        inst._i.run = _run


# control: an explicitly annotated parameter
def parse_typed(schema: Schema, value: int) -> int:
    return schema._i.run(value)


# control: a parameter annotated with a bounded TypeVar
T = TypeVar("T", bound=Schema)


def parse_bound(schema: T, value: int) -> int:
    return schema._i.run(value)


# The lambdas below have no caller in this tree, so argument flow cannot type `schema`;
# only the annotation on the name each is assigned to can.
Parse = Callable[[Schema, int], int]
parse: Parse = lambda schema, value: schema._i.run(value)

parse_inline: Callable[[Schema, int], int] = lambda schema, value: schema._i.run(value)
parse_dotted: typing.Callable[[Schema, int], int] = lambda schema, value: schema._i.run(value)

GParse = Callable[[T, int], int]
parse_tv: GParse = lambda schema, value: schema._i.run(value)


class GenericParse(Protocol[T]):
    def __call__(self, schema: T, value: int) -> int: ...


parse_protocol: GenericParse[Schema] = lambda schema, value: schema._i.run(value)


def main() -> None:
    s = Schema()
    init(s, True)
    print(parse_typed(s, 1), parse_bound(s, 2))
    init(s, False)
    print(parse_typed(s, 3))


main()
