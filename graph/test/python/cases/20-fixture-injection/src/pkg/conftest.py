"""A NEARER conftest than the one at the root. Both declare `layered`.

pytest walks ancestor directories nearest-first and runs exactly one fixture, so a test
in this directory must reach THIS `layered` and not the root's. Emitting both would be
the over-approximation the engine refuses elsewhere: it is not a union over things that
might happen, it is a claim about a function that demonstrably does not run.
"""


def fixture(*a, **kw):
    if len(a) == 1 and not kw and callable(a[0]):
        return a[0]
    return lambda f: f


def near_source():
    return "near"


@fixture
def layered():
    return near_source()
