"""FAMILY 05 — decorator-produced callables.
The largest miss cluster on transformers (284 of 492). The name binds to what the
decorator RETURNED, defined in another module."""
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
