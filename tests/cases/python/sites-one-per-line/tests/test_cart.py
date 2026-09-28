from shop.cart import receipt


def test_receipt():
    assert receipt([1, 2]) == "paid 3"
