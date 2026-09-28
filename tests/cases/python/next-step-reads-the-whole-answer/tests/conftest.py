import pytest

from client import make_client


@pytest.fixture
def plain_client():
    return make_client()
