"""PEP 530 async comprehensions (their own scope, same '.0'-style synthetic
iterator machinery as sync comprehensions, but reachable only inside an
async def), `async with` binding two context managers in one statement,
expression-form `yield` used for two-way communication, and cooperative
multiple inheritance where every class in the MRO forwards **kwargs
through super().__init__."""

import asyncio


async def aiter_values(n):
    for i in range(n):
        await asyncio.sleep(0)
        yield i


async def collect_list(n):
    # async comprehension: `async for` inside a list display
    return [value async for value in aiter_values(n)]


async def collect_filtered_set(n):
    # async comprehension with a guard condition
    return {value async for value in aiter_values(n) if value % 2 == 0}


async def collect_mapping(n):
    return {value: value * value async for value in aiter_values(n)}


async def collect_with_await_in_body(items):
    # `await` used *inside* a synchronous `for`, contrasted with the
    # `async for` forms above
    return [await item for item in items]


async def double_async_for(n):
    # two `async for` clauses in one comprehension, still one scope
    return [
        (a, b)
        async for a in aiter_values(n)
        async for b in aiter_values(n)
        if a != b
    ]


class ConnA:
    async def __aenter__(self):
        return "A"

    async def __aexit__(self, *exc):
        return False


class ConnB:
    async def __aenter__(self):
        return "B"

    async def __aexit__(self, *exc):
        return False


async def open_both():
    # a single `async with` binding two context managers at once
    async with ConnA() as a, ConnB() as b:
        return a, b


def echo_channel():
    # expression-form `yield`: the generator both produces and receives
    # values through the same statement
    received = None
    while True:
        received = yield received


def running_total():
    total = 0
    while True:
        delta = yield total
        if delta is None:
            return total
        total += delta


class Base:
    def __init__(self, **kwargs):
        self.base_kwargs = kwargs
        super().__init__()


class MixinA:
    def __init__(self, a_value=None, **kwargs):
        self.a_value = a_value
        super().__init__(**kwargs)


class MixinB:
    def __init__(self, b_value=None, **kwargs):
        self.b_value = b_value
        super().__init__(**kwargs)


class Combined(MixinA, MixinB, Base):
    # cooperative __init__: every class in the MRO pops its own keyword
    # and forwards the rest via super().__init__(**kwargs) — none of them
    # names the others, so the chain only works because of C3 order
    def __init__(self, own_value=None, **kwargs):
        self.own_value = own_value
        super().__init__(**kwargs)
