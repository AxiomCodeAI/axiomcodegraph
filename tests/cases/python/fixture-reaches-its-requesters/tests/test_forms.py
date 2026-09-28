import pytest

from shop.svc import make_cart


@pytest.fixture
def cart():
    return make_cart([1])


def test_cart(cart):
    assert cart == [1]


def test_unrelated():
    assert True
