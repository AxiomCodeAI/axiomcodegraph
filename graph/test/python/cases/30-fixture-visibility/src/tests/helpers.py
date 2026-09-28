"""Imported by NAME into one test module, which makes `helper_fx` an attribute of that
module and so a fixture the runner finds there, and only there."""
import pytest

from app.svc import make_helper


@pytest.fixture
def helper_fx():
    return make_helper()
