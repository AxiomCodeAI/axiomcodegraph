import pytest

from app.cart import build_cart, empty_cart


@pytest.fixture
def cart():
    return build_cart([1])


@pytest.fixture
def blank():
    return empty_cart()
