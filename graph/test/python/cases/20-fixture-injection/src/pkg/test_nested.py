"""A test below the conftest, in a module that ALSO declares a fixture of its own.

Three things are asserted here and each fails under a different wrong rule:

  shared_db   comes from the ROOT conftest.py, whose governed prefix is the empty
              string. A strict `>` on the conftest basename excludes a root conftest
              entirely and this edge disappears.
  layered     is declared in BOTH conftests. Nearest wins, so this must reach
              pkg/conftest.py and never the root's.
  client      is declared in ../main.py and in ../other/test_sibling.py, neither of
              them visible here. This must reach NOTHING.

And the module declares `local_only`, which is the point of the file. Suppression is
per (requester, NAME): declaring a fixture shadows THAT NAME and no other. A rule that
suppressed the conftest branch per REQUESTER would see this module declares a fixture
and drop the shared_db and layered edges with it.
"""


def fixture(*a, **kw):
    if len(a) == 1 and not kw and callable(a[0]):
        return a[0]
    return lambda f: f


def local_source():
    return "local"


@fixture
def local_only():
    return local_source()


def test_nested(shared_db, client):
    return (shared_db, client)


def test_shadowed(layered):
    """`layered` is declared in BOTH conftests. Exactly one edge, to pkg/conftest.py."""
    return layered


def test_local_and_inherited(local_only, shared_db):
    """The discriminating case: a module-local fixture AND an inherited one, together.
    Name-keyed suppression keeps both edges; requester-keyed drops shared_db."""
    return (local_only, shared_db)
