from shop.cart import checkout


def test_empty():
    assert checkout([]) == 0


def test_one():
    assert checkout([2]) == 2


def test_two():
    assert checkout([1, 2]) == 3
