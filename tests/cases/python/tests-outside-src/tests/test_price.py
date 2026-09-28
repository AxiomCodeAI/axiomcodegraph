from app.pricing import price


def test_price():
    assert price(2) == 6
