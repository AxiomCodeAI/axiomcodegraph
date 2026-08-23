"""One instance of every py_expression kind that needs no external callee."""


class Holder:
    def __init__(self, n: int) -> None:
        self.n = n

    def value(self) -> int:
        return self.n


def literals():
    return (1, 1.5, 1j, "s", b"b", True, None, ..., 0x0010, 1_000, "a" "b")


def collections_and_comprehensions():
    lst = [1, 2]
    st = {1, 2}
    dct = {"k": 1}
    tup = (1, 2)
    gen = (i for i in lst)
    return lst, st, dct, tup, gen


def operators(a: int, b: int):
    unary = -a
    binary = a + b
    boolean = a and b
    compare = a < b
    ternary = a if b else b
    walrus = (w := a)
    return unary, binary, boolean, compare, ternary, walrus


def subscripts_and_slices(seq):
    return seq[0], seq[1:2], seq[::2], seq[1:2:3]


def fstrings(a: int) -> str:
    return f"{a}{a!r}{a:>3}"


def starred(a, b):
    first, *rest = [a, b]
    return [*rest, a], {**{"x": 1}}


def assignments():
    plain = 1
    annotated: int = 2
    plain += 1
    chained = other = 3
    return plain, annotated, chained, other


def exercise() -> int:
    return Holder(1).value()
