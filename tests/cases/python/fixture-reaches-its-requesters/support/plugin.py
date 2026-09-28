import pytest

from shop.svc import make_service


@pytest.fixture
def service():
    return make_service()
