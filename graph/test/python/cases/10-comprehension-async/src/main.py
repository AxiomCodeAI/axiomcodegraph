"""10 -- comprehension and generator scopes, async def / await.

INTENT: comprehensions compile to SEPARATE CODE OBJECTS (`<listcomp>`,
`<genexpr>`, ...) that the IR does not model as methods. A call made inside one
must be attributed to the lexically containing function on BOTH sides, or the
oracle manufactures a caller the engine could never emit. That fold is
normalisation Rule 3 and it is applied identically to CPython's frames and to
the IR.

A GENERATOR FUNCTION is different and is deliberately here as the contrast: `def`
with a `yield` is a real function with a real anchor, and is NOT folded.

`async def` / `await` add a third shape: awaiting a coroutine runs its body, so
tier 4 sees the edge, but the `await` expression itself is not a call opcode --
the call that creates the coroutine is.
"""
import asyncio


def scale(n):
    return n * 2


def uses_comprehensions(items):
    # Each of these is its own code object; the calls to `scale` inside them
    # belong to `uses_comprehensions`.
    squares = [scale(i) for i in items]
    lookup = {i: scale(i) for i in items}
    lazy = (scale(i) for i in items)
    uniq = {scale(i) for i in items}
    return squares, lookup, sum(lazy), len(uniq)


def counter(limit):
    # A generator FUNCTION: a real function, not a folded scope.
    for i in range(limit):
        yield scale(i)


def drain():
    return sum(counter(4))


async def fetch(n):
    # Awaiting a coroutine that itself awaits.
    await asyncio.sleep(0)
    return scale(n)


async def gather_all():
    total = 0
    for n in (1, 2, 3):
        total += await fetch(n)
    return total


def main():
    print(uses_comprehensions([1, 2, 3]))
    print(drain())
    print(asyncio.run(gather_all()))


if __name__ == "__main__":
    main()
