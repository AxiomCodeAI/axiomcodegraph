"""A DIRECT parametrize argname is a value the runner passes in, not a fixture request.
An indirect one goes through the fixture."""
import pytest


@pytest.mark.parametrize("user", [{"name": "direct"}])
def test_direct(user):
    """NOTHING: `user` is supplied by the parametrize decorator."""
    assert user["name"] == "direct"


@pytest.mark.parametrize("user, cache", [({"name": "a"}, "c")])
def test_direct_pair(user, cache):
    """NOTHING for either: both argnames are parametrized directly."""
    assert user and cache


@pytest.mark.parametrize("user", ["other"], indirect=True)
def test_indirect(user):
    """tests/conftest.py::user, which receives "other" as request.param."""
    assert user


@pytest.mark.parametrize("n", [1, 2])
def test_other_argname(n, user):
    """tests/conftest.py::user: only `n` is parametrized."""
    assert user and n


def test_plain(user):
    """tests/conftest.py::user."""
    assert user
