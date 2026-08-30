"""FAMILY: callable instances, closures, registries, module-level functions."""


class Doubler:
    def __call__(self, x: int) -> int:
        return x * 2

    def described(self) -> str:
        return "Doubler"


class Tripler(Doubler):
    def __call__(self, x: int) -> int:
        return x * 3


def module_fn(x: int) -> int:
    return x + 1


def make_adder(n: int):
    def added(x: int) -> int:       # closure returned from a factory
        return x + n
    return added


class Registry:
    """A dict of BOUND METHODS, indexed by a key -- the shape that needs the key
    to be a static literal for the dispatch to be resolvable."""

    def alpha(self) -> str:
        return "Registry.alpha"

    def beta(self) -> str:
        return "Registry.beta"

    def __init__(self) -> None:
        self.table = {"a": self.alpha, "b": self.beta}

    def dispatch(self, key: str) -> str:
        return self.table[key]()
