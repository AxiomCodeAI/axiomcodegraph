"""A fixture imported by name into the test module is a fixture of this module."""
from .helpers import helper_fx


def test_helper(helper_fx):
    """tests/helpers.py::helper_fx, through the import above."""
    assert helper_fx


def test_repo_here(repo):
    """tests/fixtures.py::repo, through the conftest star import, as in test_svc.py."""
    assert repo
