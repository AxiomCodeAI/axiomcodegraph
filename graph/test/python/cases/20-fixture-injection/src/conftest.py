"""A conftest fixture is inherited by every test at or below this directory.

This is the half of the runner's resolution rule that a single-file case cannot show:
`shared_db` is declared here and requested from `pkg/test_nested.py`, which is a
different module in a subdirectory. Matching on the name alone would get this right by
accident; the point is that it must still be right once the name match is restricted.
"""


def fixture(*a, **kw):
    if len(a) == 1 and not kw and callable(a[0]):
        return a[0]
    return lambda f: f


def open_pool():
    return "pool"


@fixture
def shared_db():
    return open_pool()


def far_source():
    return "far"


@fixture
def layered():
    """Shadowed for anything under pkg/ by pkg/conftest.py's `layered`. A test in pkg/
    must NOT reach this one, and a test beside this file must."""
    return far_source()
