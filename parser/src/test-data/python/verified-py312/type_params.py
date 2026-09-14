"""PEP 695 generics. 3.12+ only — this file cannot parse on 3.10.

Admitted under the same rule as the rest of `verified/`: every call site here
links to a declared entity or is a builtin, so the ceiling is exactly 100%.
"""
type Alias[W] = list[W]
type Bounded[X: int] = set[X]


class Box[T]:
    def __init__(self, item: T) -> None:
        self.item = item

    def get[U](self, other: U) -> T:
        return self.item


class Pair[K: str, V]:
    def __init__(self, key: K, value: V) -> None:
        self.key = key
        self.value = value


class Variadic[T, *Ts, **P]:
    pass


def identity[V](value: V) -> V:
    return value


def bounded[N: int](n: N) -> N:
    return n


async def agen[A](a: A) -> A:
    return a


def use() -> int:
    box = Box(1)
    return box.get(2)
