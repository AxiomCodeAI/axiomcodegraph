"""FAMILY: decorator-produced callables.
This is the largest miss cluster on transformers (284 of 492): the name binds to
what the decorator RETURNED, in a different module from the call."""
import functools


def retry(times: int = 1):
    def deco(fn):
        @functools.wraps(fn)
        def inner(*a, **k):          # the real target of a @retry'd call
            return fn(*a, **k)
        return inner
    return deco


def tagged(fn):
    @functools.wraps(fn)
    def inner(*a, **k):              # the real target of a @tagged call
        return fn(*a, **k)
    return inner


@tagged
def wrapped_fn(x: int) -> int:
    return x * 10
