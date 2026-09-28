"""A plugin module, loaded because the root conftest lists it in `pytest_plugins`.

A plugin's fixtures are registered for the whole session, so every test sees `service`,
including the one under other/, which is outside the conftest's own directory.
"""
import pytest

from app.svc import make_service


@pytest.fixture
def service():
    return make_service()
