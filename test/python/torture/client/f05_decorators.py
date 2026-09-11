"""FAMILY 05 — decorator-produced callables.
The largest miss cluster on transformers (284 of 492). The name binds to what the
decorator RETURNED, defined in another module.

AND "another module" IS THE WHOLE DIFFICULTY, which is what #375 turned out to be.
`@tagged` and `@retry(times=2)` are declared in the staged library, so naming what
they return needs the LIBRARY'S OWN body — its return flow, read with its own
provenance, and then carried to the edge layer as a library method hash. Four separate
links were missing and each one alone left this family's output unchanged, so the
cluster looked like a semantic blind spot rather than four pieces of plumbing.
`call_client_decorated` is the site that proves it: two declared unknowns became
`tlib.decorated.tagged.<locals>.inner` and
`tlib.decorated.retry.<locals>.deco.<locals>.inner`, which are the functions CPython
actually runs."""
from tlib import retry, tagged, wrapped_fn


@tagged
def client_tagged(x: int) -> int:
    return x + 1


@retry(times=2)
def client_retried(x: int) -> int:
    return x + 2


def call_lib_decorated() -> int:
    return wrapped_fn(3)                # target is decorated.tagged.inner


def call_client_decorated() -> int:
    return client_tagged(1) + client_retried(1)


def decorator_factory_applied() -> int:
    deco = retry(times=1)               # factory call, then application
    fn = deco(lambda x: x)
    return fn(7)
