import pytest

from shop.svc import make_repo


@pytest.fixture
def repo():
    return make_repo()
