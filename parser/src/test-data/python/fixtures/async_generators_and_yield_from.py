"""async/await, async generators, async context managers (__aenter__/
__aexit__ and @asynccontextmanager), `async for`/`async with`, and a plain
generator that delegates via `yield from`."""

import asyncio
from contextlib import asynccontextmanager


async def fetch(url):
    await asyncio.sleep(0)
    return f"body of {url}"


async def fetch_all(urls):
    results = []
    async for url in as_completed_stream(urls):
        results.append(url)
    return results


async def as_completed_stream(urls):
    # async generator: contains both `await` and `yield`
    for url in urls:
        body = await fetch(url)
        yield body


class ConnectionPool:
    """Async context manager implemented via dunder methods."""

    async def __aenter__(self):
        self.connection = await fetch("connect")
        return self.connection

    async def __aexit__(self, exc_type, exc, tb):
        self.connection = None
        return False


@asynccontextmanager
async def open_pool():
    pool = ConnectionPool()
    conn = await pool.__aenter__()
    try:
        yield conn
    finally:
        await pool.__aexit__(None, None, None)


async def run_batch(urls):
    async with ConnectionPool() as conn:
        return [await fetch(f"{conn}/{u}") for u in urls]


def flatten(nested):
    # plain (non-async) generator delegating to sub-iterables
    for chunk in nested:
        if isinstance(chunk, list):
            yield from flatten(chunk)
        else:
            yield chunk


def numbered(iterable):
    # `yield from` combined with a return value captured via `.value`-style
    # StopIteration protocol (parenthesized to keep it a single expression)
    index = 0
    for item in iterable:
        received = yield from single_pass(item, index)
        index = received
