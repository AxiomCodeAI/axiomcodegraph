import pytest

from shop.svc import make_widget


@pytest.fixture
def widget():
    return make_widget()
