"""FAMILY 02 — callable instances, closures, registries."""
from tlib import Doubler, Registry, Tripler, make_adder, module_fn


class LocalCallable:
    def __call__(self, x: int) -> int:
        return x - 1


class HoldsCallables:
    def __init__(self) -> None:
        self.lib_call = Doubler()       # attribute holding a LIB callable
        self.own_call = LocalCallable()  # attribute holding a CLIENT callable

    def run(self) -> int:
        return self.lib_call(4) + self.own_call(9)


def bare_name_callable() -> int:
    d = Doubler()
    t = Tripler()
    return d(1) + t(1)


def constructed_directly() -> int:
    return Doubler()(5)


def closure_target() -> int:
    add5 = make_adder(5)                # closure returned from a lib factory
    return add5(1)


def module_level_fn() -> int:
    return module_fn(1)


def registry_dispatch() -> str:
    # EXPECT: miss  dict-of-bound-methods indexed inside the library
    return Registry().dispatch("a")


def attribute_callables() -> int:
    return HoldsCallables().run()
