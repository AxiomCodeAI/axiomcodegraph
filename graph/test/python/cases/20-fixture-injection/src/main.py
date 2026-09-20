"""Fixture injection: a test's PARAMETER NAME is the call.

A test runner collects `def test_total(cart)`, looks `cart` up among the declared
fixtures, calls the fixture, and passes the result in. The parameter name is the
only thing joining the two; there is no call site, so "which tests reach this
helper" -- the question test-impact exists to answer -- stops at the fixture.

The hop matters most in the direction nothing else covers: a fixture BODY calls
production code, so a test reaches that code only through the injection.

THE NEGATIVE HALF IS THE POINT. A parameter matches a fixture by name, and names
are cheap. A parameter with a DEFAULT is supplied by the caller, not injected; a
non-test function taking `cart` is not a test; and a fixture name that no test
requests must not be wired to an unrelated def that happens to share the name.
"""


def fixture(*a, **kw):
    """Stands in for the runner's fixture decorator: no framework is staged."""
    if len(a) == 1 and not kw and callable(a[0]):
        return a[0]
    return lambda f: f


# ── production code, reached ONLY through a fixture body ─────────────────────
def build_cart(rows):
    return {"rows": rows}


def connect(dsn):
    return dsn


# ── fixtures ────────────────────────────────────────────────────────────────
@fixture
def cart():
    return build_cart([1, 2])


@fixture(scope="session")
def db(dsn):
    """A fixture that itself requests one: the chain has to carry through."""
    return connect(dsn)


@fixture
def dsn():
    return "sqlite://"


@fixture
def unused_fixture():
    """Declared and never requested. No test may be wired to it."""
    return build_cart([])


# ── tests: each parameter is an injected call ───────────────────────────────
def test_total(cart):
    return cart


def test_query(db):
    """Reaches connect() only through db, which reaches dsn the same way."""
    return db


# ── NOT injection, and each would be if a condition were dropped ────────────
def test_with_default(cart=None):
    """A defaulted parameter is supplied by the caller. The runner injects nothing."""
    return cart


def helper_takes_cart(cart):
    """Not a test: the name does not start with the collection prefix."""
    return cart


def test_unknown_param(not_a_fixture):
    """No fixture declares this name, so nothing is injected and nothing is claimed."""
    return not_a_fixture
