"""Fixtures that reach tests only because tests/conftest.py star-imports this module.

The runner registers every public attribute of a conftest, and `from .fixtures import *`
makes `repo` one. `_hidden` is not re-exported by a star import (a leading underscore),
so it is not a conftest attribute and no test may reach it through the star.
"""
import pytest

from app.svc import make_hidden, make_repo


@pytest.fixture
def repo():
    return make_repo()


@pytest.fixture
def _hidden():
    return make_hidden()
